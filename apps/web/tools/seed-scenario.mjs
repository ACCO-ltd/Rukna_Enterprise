#!/usr/bin/env node
/**
 * Builds a complete ACCO billing scenario over the public HTTP API.
 *
 *   client → project (DRAFT) → BOQ (baselined) → contract (ACTIVE, with terms)
 *          → project start (DRAFT → ACTIVE) → payment application (SUBMITTED)
 *          → certificate (effective IPC) → invoice (from IPC, posted) → receipt (allocated)
 *
 * ─── Ordering (ADR-019) ──────────────────────────────────────────────────────────
 *
 * Starting a project is a single guarded `POST /projects/:id/start` (DRAFT → ACTIVE) that only
 * succeeds once its readiness conditions hold: an ACTIVE main contract with a start date, and a
 * baselined BOQ. So the scenario builds and baselines the BOQ and creates + activates the contract
 * FIRST, then starts the project — the reverse of the retired approve→mobilize→activate chain.
 *
 * ─── Settlement (ADR-024) ────────────────────────────────────────────────────────
 *
 * AR truth is a ClientInvoice raised from the effective IPC, posted to the GL, then settled by a
 * customer receipt allocated to that INVOICE (ClientReceiptAllocation) — not the old
 * receipt→certificate (ReceiptAllocation→IPC) path, which was removed.
 *
 * ─── Why this exists ─────────────────────────────────────────────────────────────
 *
 * The repository has no domain seed data — `tenant:provision` creates a tenant and an
 * admin, and `acco-workflows.seed.ts` configures workflow bindings, but nothing creates
 * a project or a contract. Reaching an IPC screen by hand means a dozen requests through
 * the Scalar UI, repeated after every database reset. Screens built without data get built
 * blind.
 *
 * ─── Why it drives HTTP rather than Prisma ───────────────────────────────────────
 *
 * `apps/api/**` and `prisma/schema.prisma` are backend-owned (`apps/web/CLAUDE.md:26`).
 * This script touches neither: it calls the same endpoints the browser calls, with the
 * same auth. That keeps ownership clean, and it means the script exercises the real
 * contract — a request the API rejects fails here, loudly, rather than being discovered
 * later in a component. It doubles as executable documentation of the billing chain.
 *
 * ─── Running it ──────────────────────────────────────────────────────────────────
 *
 *   pnpm --filter @erp/web seed
 *   pnpm --filter @erp/web seed -- --api http://acco.localhost:3001/api/v1
 *
 * Every record is suffixed with a run id, so repeat runs add a fresh scenario rather than
 * colliding on the unique constraints over client code, project code and contract number.
 *
 * Plain Node with `node:http` — no dependencies and no build step, so it runs from a clean
 * checkout. (It uses `node:http`, not `fetch`, to send the tenant Host header — see below.)
 *
 * ─── ENVIRONMENT PREREQUISITES ─────────────────────────────────────────────────────
 *
 * `tenant:provision` alone is NOT enough. The scenario needs, in the target tenant:
 *   • the accounting chart + fiscal periods (prisma/seeds/accounting-phase1.seed.ts) — the
 *     invoice/receipt posting resolves AR/revenue/VAT/bank/unapplied accounts by role, and posts
 *     into an OPEN period;
 *   • the district registry (prisma/seeds/districts.seed.ts) — a project code needs a district;
 *   • an ACTIVE workflow binding for the IPA submit transition. `InterimPaymentApplication`
 *     DRAFT → PENDING_INTERNAL_APPROVAL is a REQUIRED governed transition (acco-workflows.seed.ts);
 *     provisioning seeds that requirement policy but NO matching binding, so the transition 422s
 *     ("Workflow configuration required") until the IPA approval chain is wired and activated for
 *     the tenant. A lone admin cannot self-approve it (SoD blocks a system admin from approving a
 *     business transaction), so activation with a real approver role is the intended path.
 *
 * Point at a tenant where all three are in place (e.g. via the documented dev bring-up), then run.
 */

import http from 'node:http';
import https from 'node:https';

const DEFAULTS = {
  /** Silences the step log. The end-to-end suite sets this so its reporter owns stdout. */
  quiet: false,
  api: 'http://acco.localhost:3001/api/v1',
  email: 'admin@acco.com',
  password: process.env.RUKNA_DEMO_PASSWORD,
};

const config = { ...DEFAULTS, ...parseArgs(process.argv.slice(2)) };

/** Short, readable, and unique enough to keep codes distinct across runs. */
const RUN = Date.now().toString(36).slice(-5).toUpperCase();

let accessToken = null;

// ─── HTTP ────────────────────────────────────────────────────────────────────────

const target = new URL(config.api);

/**
 * The tenant is resolved from the request's Host header (`tenancy.middleware.ts`), so this
 * script has to reach the API as `acco.localhost` — and that is the one thing `fetch`
 * cannot do here.
 *
 * Two problems compound. Windows does not resolve arbitrary `*.localhost` subdomains, so
 * `dns.lookup('acco.localhost')` answers ENOTFOUND — browsers and curl treat the whole
 * `.localhost` TLD as loopback per RFC 6761, but Node's resolver does not. And `Host` is a
 * forbidden header in undici, so setting it on a `fetch` to `127.0.0.1` is silently
 * dropped; the API then sees host `127.0.0.1` and answers `Tenant '127' not found`.
 *
 * `node:http` has neither restriction: connect to the loopback address, send the tenant
 * host explicitly. No hosts-file edit, so this runs on a clean machine.
 */
const CONNECT_HOST = /(^|\.)localhost$/.test(target.hostname) ? '127.0.0.1' : target.hostname;

function httpRequest(method, path, payload) {
  const transport = target.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        host: CONNECT_HOST,
        port: target.port,
        path: `${target.pathname.replace(/\/$/, '')}${path}`,
        method,
        headers: {
          Host: target.host, // the tenant subdomain — the whole point of this transport
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          text += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode, text }));
      },
    );

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function request(method, path, body) {
  const res = await httpRequest(method, path, body === undefined ? null : JSON.stringify(body));
  const { text } = res;
  const isOk = res.status >= 200 && res.status < 300;

  if (!isOk) {
    // The API's error envelope is { success, error: { code, message, details } }, and
    // class-validator returns `message` as an array of constraint failures. Both are
    // flattened here so a failure names the field rather than printing "[object Object]".
    let detail = text;
    try {
      const parsed = JSON.parse(text);
      const message = parsed?.error?.message ?? parsed?.message;
      detail = Array.isArray(message) ? message.join('; ') : (message ?? text);
    } catch {
      /* not JSON — the raw body is the best available detail */
    }
    throw new Error(`${method} ${path} → ${res.status}\n    ${detail}`);
  }

  // Several endpoints answer 200 with an empty body (B6) — suspend, resume, node delete.
  return text ? JSON.parse(text) : null;
}

const get = (path) => request('GET', path);
const post = (path, body) => request('POST', path, body);

// ─── Output ──────────────────────────────────────────────────────────────────────

let stepNumber = 0;

function step(label) {
  if (config.quiet) return;
  stepNumber += 1;
  process.stdout.write(`  ${String(stepNumber).padStart(2)}. ${label.padEnd(46)}`);
}

function ok(detail = '') {
  if (config.quiet) return;
  process.stdout.write(`✓ ${detail}\n`);
}

// ─── The scenario ────────────────────────────────────────────────────────────────

async function main() {
  if (!config.password) {
    throw new Error(
      'Demo password is required. Set RUKNA_DEMO_PASSWORD or pass --password <value>.',
    );
  }
  if (!config.quiet) {
    console.log(`\nSeeding ACCO billing scenario  (run ${RUN})`);
    console.log(`API: ${config.api}\n`);
  }

  // ── Auth ──────────────────────────────────────────────────────────────────────
  step('login');
  const auth = await post('/auth/login', { email: config.email, password: config.password });
  accessToken = auth.accessToken;
  ok(config.email);

  // ── Client ────────────────────────────────────────────────────────────────────
  step('create client');
  const client = await post('/clients', {
    // NOTE: no `code` field. The client code is server-generated, and CreateClientDto does
    // not declare one — sending it was a 400 (`property code should not exist`) that broke
    // this script at step 2. Unlike a project, whose code the caller chooses, a client's is
    // assigned. Read it off the response instead.
    name: 'Baraka Real Estate LLC',
    // NOTE: no `nameAr`. Arabic was removed end-to-end (English-only, PR #73); CreateClientDto
    // no longer declares it and forbidNonWhitelisted makes sending it a 400.
    taxNumber: `SO-${RUN}`,
    defaultCurrency: 'USD',
    // NOTE: no `status` field. api-reference.md documents one, but CreateClientDto does
    // not declare it and the ValidationPipe runs with forbidNonWhitelisted — sending it
    // is a 400. See D3. The client is created ACTIVE by schema default, which the project's
    // CLIENT_ACTIVE start-readiness condition requires.
  });
  ok(client.code);

  step('add client contact');
  await post(`/clients/${client.id}/contacts`, {
    name: 'Yusuf Ahmed',
    role: 'Commercial Director',
    email: `yusuf.${RUN.toLowerCase()}@baraka.example`,
    phone: '+252 61 000 0000',
    isPrimary: true,
  });
  ok();

  // ── Project ───────────────────────────────────────────────────────────────────
  // A project now requires a `districtId` (ADR-025 meaningful project codes + district
  // registry). The Banaadir districts are seeded per tenant; resolve the first active one the
  // same way the project-create picker does. `GET /districts` returns a plain array.
  step('resolve district');
  const districts = await get('/districts?activeOnly=true');
  const districtList = Array.isArray(districts) ? districts : (districts?.items ?? []);
  const district = districtList[0];
  if (!district) throw new Error('No active district seeded for this tenant.');
  ok(district.name ?? district.id);

  step('create project (DRAFT)');
  const project = await post('/projects', {
    code: `PRJ-${RUN}`,
    name: 'Hodan District Office Tower',
    description: 'Eight-storey commercial tower, Mogadishu.',
    districtId: district.id,
    // A CLIENT_CONTRACT project (the default) requires the client aggregate id, not just the
    // legacy display name (ADR-005). Without it the API rejects the create with 400
    // "A client is required for a client contract project". The seed predates that rule.
    clientId: client.id,
    clientName: client.name,
    contractValue: 4_500_000,
    currency: 'USD',
    // startDate + expectedEndDate satisfy the WAIVABLE PROGRAMME_DATES start condition naturally.
    startDate: '2026-02-01',
    expectedEndDate: '2027-08-31',
  });
  ok(project.code);

  // ADR-019: the project stays DRAFT here. `POST /projects/:id/start` (DRAFT → ACTIVE) is guarded
  // by readiness — a baselined BOQ and an ACTIVE main contract with a start date. So the BOQ and
  // contract are built FIRST (below), and the project is started AFTER them.

  // ── BOQ ───────────────────────────────────────────────────────────────────────
  step('initialize BOQ');
  const boq = await post(`/projects/${project.id}/boq`);
  const draftVersion = boq.versions.find((v) => v.status === 'DRAFT');
  if (!draftVersion) throw new Error('BOQ initialize returned no DRAFT version');
  ok(`v${draftVersion.versionNumber}`);

  step('add BOQ sections and items');
  const nodes = await buildBoqTree(project.id, draftVersion.id);
  ok(`${nodes.leaves.length} leaf items under 2 sections`);

  // A contract can only reference a BASELINED version (contract.service.ts:60).
  step('baseline the BOQ version');
  await post(`/projects/${project.id}/boq/versions/${draftVersion.id}/baseline`);
  ok('DRAFT → BASELINED');

  // ── Contract ──────────────────────────────────────────────────────────────────
  step('create contract');
  const contract = await post('/contracts', {
    projectId: project.id,
    clientId: client.id,
    boqVersionId: draftVersion.id,
    contractNumber: `ACCO-2026-${RUN}`,
    contractValue: '4500000.00',
    currency: 'USD',
    billingModel: 'MEASURED_IPC',
    startDate: '2026-02-01',
    expectedEndDate: '2027-08-31',
  });
  ok(contract.contractNumber);

  // Retention and advance terms are what C1 says the API should be deriving deductions
  // from. Seeding them means the IPC screens have something real to reconcile against.
  step('set retention terms');
  await post(`/contracts/${contract.id}/retention-terms`, {
    retentionRate: '0.0500', // 5% — Decimal(5,4), NOT "5"
    retentionCap: '0.0500',
    // Lowercase `Pc` on the way IN, uppercase `PC` on the way OUT. AddRetentionTermsDto
    // declares `retentionSplitOnPc`; the Prisma column is `retentionSplitOnPC` and the
    // repository translates between them. Sending the response's spelling is a 400.
    retentionSplitOnPc: '0.5000',
  });
  ok('5% retention, half released at PC');

  step('add advance term');
  await post(`/contracts/${contract.id}/advance-terms`, {
    advanceType: 'MOBILIZATION',
    description: 'Mobilization advance',
    amount: '450000.00',
    recoveryRate: '0.1000', // 10% of each certificate
  });
  ok('450,000 USD at 10% recovery');

  step('add guarantee and milestone');
  await post(`/contracts/${contract.id}/guarantees`, {
    guaranteeType: 'PERFORMANCE',
    amount: '450000.00',
    currency: 'USD',
    issuer: 'Salaam Bank',
    beneficiary: 'Baraka Real Estate LLC',
    issueDate: '2026-02-01',
    expiryDate: '2027-12-31',
  });
  await post(`/contracts/${contract.id}/milestones`, {
    name: 'Substructure complete',
    dueDate: '2026-06-30',
    sortOrder: 1,
  });
  ok();

  step('advance contract to ACTIVE');
  for (const command of ['submit', 'approve-review', 'execute']) {
    await post(`/contracts/${contract.id}/${command}`);
  }
  ok('client details now frozen onto the contract');

  // ── Start the project (ADR-019) ────────────────────────────────────────────────
  //
  // With a baselined BOQ and an ACTIVE main contract carrying a start date, the guarded
  // `POST /projects/:id/start` (DRAFT → ACTIVE) can run. Its readiness conditions:
  //   CLIENT_ACTIVE / ACTIVE_MAIN_CONTRACT / CONTRACT_START_DATE / BOQ_BASELINED  (MANDATORY)
  //   PROGRAMME_DATES / DELIVERY_TEAM                                             (WAIVABLE)
  // The four mandatory ones are satisfied naturally (active client + active contract with a
  // start date + baselined BOQ). PROGRAMME_DATES is satisfied by the project's planned dates.
  // DELIVERY_TEAM wants a second team member beyond the auto-enrolled PM; the seed has no other
  // user, so it carries a per-condition waiver (CONST-PLC-006) rather than inventing one. The
  // command records the actual commencement (`actualStartDate`) — the one decision Start owns.
  step('read start readiness');
  const readiness = await get(`/projects/${project.id}/readiness?command=start`);
  const unmetWaivable = readiness.conditions
    .filter((c) => !c.satisfied && c.severity === 'WAIVABLE')
    .map((c) => c.code);
  ok(`ready=${readiness.ready}${unmetWaivable.length ? ` (waive ${unmetWaivable.join(', ')})` : ''}`);

  step('start project (DRAFT → ACTIVE)');
  await post(`/projects/${project.id}/start`, {
    actualStartDate: '2026-02-01',
    commencementNote: `Seeded scenario ${RUN}: site handover complete, mobilization underway.`,
    overrides: unmetWaivable.map((condition) => ({
      condition,
      reason: 'Seed scenario: single-user tenant has no delivery team beyond the project manager.',
    })),
  });
  ok('project is ACTIVE');

  // ── Payment application ───────────────────────────────────────────────────────
  step('create payment application');
  const ipa = await post('/ipa', {
    contractId: contract.id,
    periodFrom: '2026-05-01',
    periodTo: '2026-05-31',
    notes: `Seeded scenario ${RUN}`,
  });
  ok();

  step('claim BOQ lines');
  for (const leaf of nodes.leaves) {
    await post(`/ipa/${ipa.id}/items`, {
      boqNodeId: leaf.id,
      // ~40% of the contracted quantity claimed to date.
      cumulativeClaimed: (leaf.quantity * 0.4).toFixed(3),
    });
  }
  ok(`${nodes.leaves.length} lines`);

  const ipaWithItems = await get(`/ipa/${ipa.id}`);
  const gross = Number(ipaWithItems.totalPeriodAmount);

  step('add retention deduction');
  const retention = round2(gross * 0.05);
  await post(`/ipa/${ipa.id}/deductions`, {
    deductionType: 'RETENTION',
    rate: '0.0500',
    basis: gross.toFixed(2),
    amount: retention.toFixed(2),
  });
  ok(`${retention.toFixed(2)} USD on a ${gross.toFixed(2)} basis`);

  // The first IPA transition (DRAFT → PENDING_INTERNAL_APPROVAL) is governed by a REQUIRED
  // WorkflowRequirementPolicy (acco-workflows.seed.ts): with no ACTIVE trigger binding for it, the
  // API returns 422 "Workflow configuration required". A freshly-provisioned tenant seeds this
  // policy but no matching IPA binding, and a lone admin cannot self-approve (SoD blocks it), so
  // the IPA chain must be wired + activated in the tenant before this seeder can submit an IPA.
  // See the ENVIRONMENT note in the file header.
  step('advance application to SUBMITTED');
  await submitIpa(ipa.id);
  const submitted = await get(`/ipa/${ipa.id}`);
  ok(submitted.applicationRef ?? 'submitted');

  // ── Certificate ───────────────────────────────────────────────────────────────
  //
  // Everything below is the arithmetic C1 asks the API to own. It lives here, in a seed
  // script, deliberately — and NOT in the application, which is why IPC issuance is the
  // last screen in the plan. The certifier cuts one line by 10% to exercise the variance
  // reason the API requires when certified ≠ claimed.
  step('issue certificate');
  const certifiedItems = submitted.items.map((item, index) => {
    const claimed = Number(item.cumulativeClaimed);
    const cut = index === 0;
    const certifiedQuantity = cut ? round3(claimed * 0.9) : claimed;
    return {
      payload: {
        applicationItemId: item.id,
        certifiedQuantity: certifiedQuantity.toFixed(3),
        ...(cut ? { varianceReason: 'Quantity re-measured on site; 10% not yet in place.' } : {}),
      },
    };
  });

  const certificate = await post('/ipc', {
    applicationId: ipa.id,
    status: 'CERTIFIED',
    currency: 'USD',
    items: certifiedItems.map((i) => i.payload),
  });
  ok(certificate.certificateRef ?? `#${certificate.certificateNumber}`);

  const issued = await get(`/ipc/${certificate.id}`);
  const netCertified = Number(issued.netCertified);

  // A separate submitted application with no certificates is reserved for the browser
  // certification workflow. Keeping it separate prevents issue/supersession tests from
  // changing the effective paid certificate used by the reconciliation assertions.
  step('create application for certification workflow');
  const certificationIpa = await post('/ipa', {
    contractId: contract.id,
    periodFrom: '2026-06-01',
    periodTo: '2026-06-30',
    notes: `Certification workflow ${RUN}`,
  });
  for (const leaf of nodes.leaves) {
    await post(`/ipa/${certificationIpa.id}/items`, {
      boqNodeId: leaf.id,
      cumulativeClaimed: (leaf.quantity * 0.5).toFixed(3),
    });
  }
  await submitIpa(certificationIpa.id);
  const submittedCertificationIpa = await get(`/ipa/${certificationIpa.id}`);
  ok(submittedCertificationIpa.applicationRef ?? 'submitted');

  // ── Invoice from the effective IPC (ADR-024) ───────────────────────────────────
  //
  // AR truth is a ClientInvoice raised from the effective certificate, posted to the GL, then
  // settled by a customer receipt allocated to that INVOICE. The old receipt→certificate
  // (ReceiptAllocation→IPC) path was removed. `generateFromIpc` is idempotent (one invoice per
  // effective IPC) and adds 5% output VAT, so the receivable is certifiedTotal × 1.05.
  step('generate invoice from IPC');
  const invoice = await post('/invoices/from-ipc', {
    ipcId: certificate.id,
    invoiceDate: '2026-06-15',
    dueDate: '2026-07-15',
    paymentTerms: 'Net 30',
  });
  const invoiceTotal = Number(invoice.totalAmount);
  ok(`${invoiceTotal.toFixed(2)} USD (incl. 5% VAT)`);

  // DRAFT → APPROVED → POSTED. Only a POSTED invoice can be allocated against (it books the AR
  // receivable and draws the INV- number). Control accounts resolve server-side by role
  // (ACC-POST-001), so post carries an empty body.
  step('approve and post invoice');
  await post(`/invoices/${invoice.id}/approve`);
  await post(`/invoices/${invoice.id}/post`, {});
  const postedInvoice = await get(`/invoices/${invoice.id}`);
  ok(postedInvoice.invoiceNumber ?? 'POSTED');

  // ── Receipt (ADR-024) ──────────────────────────────────────────────────────────
  // Receipts moved to /customer-receipts (ACC-SET-001). Create records it NOT_POSTED; posting to
  // the GL with an inline allocation to the invoice settles it in one call. `bankAccountCode` is
  // the Salaam Bank cash GL (10100, seeded); AR/unapplied resolve by role.
  step('record customer receipt');
  const receipt = await post('/customer-receipts', {
    clientId: client.id,
    receiptDate: '2026-06-20',
    amount: invoiceTotal.toFixed(2),
    currency: 'USD',
    reference: `TT-${RUN}`,
    notes: 'Bank transfer, Salaam Bank',
  });
  ok(`${invoiceTotal.toFixed(2)} USD`);

  step('post receipt and allocate to invoice');
  await post(`/customer-receipts/${receipt.id}/post`, {
    bankAccountCode: '10100', // Salaam Bank cash GL (seeded chart of accounts)
    allocations: [{ clientInvoiceId: invoice.id, amount: invoiceTotal }],
  });
  const payment = await get(`/customer-receipts/certificate/${certificate.id}/payment-status`);
  ok(payment.status);

  const scenario = {
    project,
    client,
    contract,
    ipa: submitted,
    certificationIpa: submittedCertificationIpa,
    certificate: issued,
    invoice: postedInvoice,
    receipt,
    payment,
    netCertified,
    invoiceTotal,
  };

  summarize(scenario);
  return scenario;
}

/**
 * Seeds a scenario and returns its records, for callers that need the ids.
 *
 * The end-to-end suite uses this so it never depends on whatever happens to be in the
 * database. Kept as one exported function with the CLI wrapper below, rather than
 * duplicated, so the thing the tests run is the thing a developer runs.
 */
export async function seedScenario(options = {}) {
  Object.assign(config, options);
  accessToken = null;
  stepNumber = 0;
  return main();
}

/**
 * Two sections with two priced leaves each — enough structure for the tree to be worth
 * rendering, and enough lines for a certificate to cut one and leave one alone.
 *
 * Rates and quantities are returned alongside the created ids because the IPA item
 * endpoint requires the caller to supply the rate (C3), so the script has to remember what
 * it priced each line at.
 */
async function buildBoqTree(projectId, versionId) {
  const base = `/projects/${projectId}/boq/versions/${versionId}/nodes`;
  const leaves = [];

  const plan = [
    {
      code: '01',
      description: 'Substructure Works',
      items: [
        {
          code: '01.01',
          description: 'Excavation in ordinary soil',
          unit: 'm³',
          quantity: 1200,
          unitRate: 45,
        },
        {
          code: '01.02',
          description: 'Reinforced concrete foundations',
          unit: 'm³',
          quantity: 480,
          unitRate: 320,
        },
      ],
    },
    {
      code: '02',
      description: 'Superstructure Works',
      items: [
        {
          code: '02.01',
          description: 'Reinforced concrete columns',
          unit: 'm³',
          quantity: 260,
          unitRate: 410,
        },
        {
          code: '02.02',
          description: 'Blockwork walls, 200mm',
          unit: 'm²',
          quantity: 3400,
          unitRate: 28,
        },
      ],
    },
  ];

  for (const [sectionIndex, section] of plan.entries()) {
    const created = await post(base, {
      sortOrder: sectionIndex + 1,
      code: section.code,
      description: section.description,
      isLeaf: false,
    });

    for (const [itemIndex, item] of section.items.entries()) {
      const leaf = await post(base, {
        parentId: created.id,
        sortOrder: itemIndex + 1,
        code: item.code,
        description: item.description,
        isLeaf: true,
        unit: item.unit,
        quantity: item.quantity,
        unitRate: item.unitRate,
        currency: 'USD',
        // NOTE: measurementMethod and pricingBasis cannot be set — no DTO accepts them,
        // so every node is QUANTITY / UNIT_RATE by schema default. See C9.
      });
      leaves.push({ id: leaf.id, quantity: item.quantity, unitRate: item.unitRate });
    }
  }

  return { leaves };
}

/**
 * Walk an IPA DRAFT → SUBMITTED. The first hop is governed (ADR-022): a REQUIRED requirement
 * policy with no active binding answers 422, which no HTTP client can satisfy on its own. Rethrow
 * it with the concrete remediation rather than the bare envelope, so the failure names the fix.
 */
async function submitIpa(ipaId) {
  for (const command of ['submit-for-approval', 'approve-for-submission', 'submit']) {
    try {
      await post(`/ipa/${ipaId}/${command}`);
    } catch (error) {
      if (command === 'submit-for-approval' && /→ 422/.test(error.message)) {
        throw new Error(
          `${error.message}\n` +
            '    The IPA submit transition is a REQUIRED governed transition with no active workflow\n' +
            '    binding in this tenant. Wire + activate the InterimPaymentApplication approval chain\n' +
            '    (governance config) before seeding, or run against a tenant where it is already active.',
        );
      }
      throw error;
    }
  }
}

function summarize(s) {
  if (config.quiet) return;
  const line = '─'.repeat(74);
  console.log(`\n${line}`);
  console.log('Scenario ready\n');
  console.log(`  Project      ${s.project.code}  ${s.project.name}`);
  console.log(`  Client       ${s.client.code}  ${s.client.name}`);
  console.log(`  Contract     ${s.contract.contractNumber}  (ACTIVE)`);
  console.log(`  Application  ${s.ipa.applicationRef ?? s.ipa.id}  (${s.ipa.status})`);
  console.log(
    `  Certificate  ${s.certificate.certificateRef ?? s.certificate.id}  (${s.certificate.status})`,
  );
  console.log(
    `  Invoice      ${s.invoice.invoiceNumber ?? s.invoice.id}  (${s.invoice.postingStatus})`,
  );
  console.log(`  Receipt      ${s.receipt.reference}  ${s.invoiceTotal.toFixed(2)} USD\n`);
  console.log(`  Gross certified   ${s.certificate.totalCertifiedAmount} USD`);
  console.log(`  Deductions        ${s.certificate.totalDeductions} USD`);
  console.log(`  Net certified     ${s.certificate.netCertified} USD`);
  console.log(`  Invoice total     ${s.payment.invoiceTotal} USD  (incl. ${s.payment.vatAmount} VAT)`);
  console.log(`  Received          ${s.payment.totalReceived} USD  →  ${s.payment.status}`);

  if (s.payment.status !== 'PAID') {
    console.log(
      `\n  ⚠  The receipt should settle the invoice in full, yet the API reports\n` +
        `     ${s.payment.status} (outstanding ${s.payment.outstanding} USD).`,
    );
  }

  console.log(`\n  Open:  ${webBase()}/projects/${s.project.id}`);
  console.log(`${line}\n`);
}

/**
 * The web app runs on the same tenant subdomain as the API, on port 3000. Derive it from the
 * configured API target so the "Open" link points at the tenant the scenario was seeded into,
 * not a hardcoded `acco.`.
 */
function webBase() {
  const url = new URL(config.api);
  return `${url.protocol}//${url.hostname}:3000`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────────

/** Money at 2dp. Only ever used to build a request body — never to reconcile one. */
function round2(n) {
  return Math.round(n * 100) / 100;
}

/** Quantities are Decimal(18,3). */
function round3(n) {
  return Math.round(n * 1000) / 1000;
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    if (key in DEFAULTS) {
      parsed[key] = argv[i + 1];
      i += 1;
    }
  }
  return parsed;
}

/**
 * CLI entry. Only runs when this file is executed directly — importing it (as the
 * end-to-end suite does) must not seed a scenario as a side effect.
 */
const isCli = /(?:^|[\\/])seed-scenario\.mjs$/i.test(process.argv[1] ?? '');

if (isCli) {
  main().catch((error) => {
    console.error(`\n✗ ${error.message}\n`);
    if (error.code === 'ECONNREFUSED' || error.message.includes('ECONNREFUSED')) {
      console.error('  Is the API running?  pnpm --filter @erp/api dev');
      console.error('  Is Postgres up?      docker compose up -d\n');
    }
    process.exitCode = 1;
  });
}
