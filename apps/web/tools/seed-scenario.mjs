#!/usr/bin/env node
/**
 * Builds a complete ACCO billing scenario over the public HTTP API.
 *
 *   client → project → BOQ (baselined) → contract (ACTIVE, with terms)
 *          → payment application (SUBMITTED) → certificate → receipt (allocated)
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
 * Plain Node with global `fetch` — no dependencies and no build step, so it runs from a
 * clean checkout.
 */

import http from 'node:http';
import https from 'node:https';

const DEFAULTS = {
  /** Silences the step log. The end-to-end suite sets this so its reporter owns stdout. */
  quiet: false,
  api: 'http://acco.localhost:3001/api/v1',
  email: 'admin@acco.com',
  password: 'ChangeMe123!',
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
    code: `CL-${RUN}`,
    name: 'Baraka Real Estate LLC',
    nameAr: 'شركة البركة للعقارات',
    taxNumber: `SO-${RUN}`,
    defaultCurrency: 'USD',
    // NOTE: no `status` field. api-reference.md documents one, but CreateClientDto does
    // not declare it and the ValidationPipe runs with forbidNonWhitelisted — sending it
    // is a 400. See D3.
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
  step('create project');
  const project = await post('/projects', {
    code: `PRJ-${RUN}`,
    name: 'Hodan District Office Tower',
    nameAr: 'برج مكاتب حي هودان',
    description: 'Eight-storey commercial tower, Mogadishu.',
    clientName: client.name,
    contractValue: 4_500_000,
    currency: 'USD',
    startDate: '2026-02-01',
    expectedEndDate: '2027-08-31',
  });
  ok(project.code);

  // A contract can be created against a DRAFT project, but a project that never leaves
  // DRAFT is not a realistic backdrop for the billing screens.
  step('advance project to ACTIVE');
  for (const command of ['approve', 'mobilize', 'activate']) {
    await post(`/projects/${project.id}/${command}`);
  }
  ok('DRAFT → APPROVED → MOBILIZING → ACTIVE');

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
      // C3: the API takes this rate from the request rather than the BOQ node. The value
      // sent here is the node's own rate, which is what the API should be reading itself.
      unitRateSnapshot: leaf.unitRate.toFixed(2),
      currencySnapshot: 'USD',
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

  step('advance application to SUBMITTED');
  for (const command of ['submit-for-approval', 'approve-for-submission', 'submit']) {
    await post(`/ipa/${ipa.id}/${command}`);
  }
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
      // The amount is carried alongside the payload rather than inside it: the API derives
      // each item's certifiedAmount itself, but requires the caller to send the TOTAL of
      // those same amounts as `certifiedTotal`. That asymmetry is C1.
      amount: round2(certifiedQuantity * Number(item.unitRateSnapshot)),
      payload: {
        applicationItemId: item.id,
        certifiedQuantity: certifiedQuantity.toFixed(3),
        ...(cut ? { varianceReason: 'Quantity re-measured on site; 10% not yet in place.' } : {}),
      },
    };
  });

  const certifiedTotal = round2(certifiedItems.reduce((sum, i) => sum + i.amount, 0));
  const certRetention = round2(certifiedTotal * 0.05);
  const advanceRecovery = round2(certifiedTotal * 0.1);

  const certificate = await post('/ipc', {
    applicationId: ipa.id,
    status: 'CERTIFIED',
    certifiedTotal: certifiedTotal.toFixed(2),
    currency: 'USD',
    items: certifiedItems.map((i) => i.payload),
    deductions: [
      {
        deductionType: 'RETENTION',
        rate: '0.0500',
        basis: certifiedTotal.toFixed(2),
        amount: certRetention.toFixed(2),
      },
      {
        deductionType: 'ADVANCE_RECOVERY',
        rate: '0.1000',
        basis: certifiedTotal.toFixed(2),
        amount: advanceRecovery.toFixed(2),
      },
    ],
  });
  ok(certificate.certificateRef ?? `#${certificate.certificateNumber}`);

  const issued = await get(`/ipc/${certificate.id}`);
  const netCertified = Number(issued.netCertified);

  // ── Receipt ───────────────────────────────────────────────────────────────────
  step('record receipt for the net certified');
  const receipt = await post('/receipts', {
    clientId: client.id,
    receiptDate: '2026-06-20',
    amount: netCertified.toFixed(2),
    currency: 'USD',
    reference: `TT-${RUN}`,
    notes: 'Bank transfer, Salaam Bank',
  });
  ok(`${netCertified.toFixed(2)} USD`);

  step('allocate receipt to the certificate');
  await post(`/receipts/${receipt.id}/allocations`, {
    certificateId: certificate.id,
    allocatedAmount: netCertified.toFixed(2),
  });
  const payment = await get(`/receipts/certificate/${certificate.id}/payment-status`);
  ok(payment.status);

  const scenario = {
    project,
    client,
    contract,
    ipa: submitted,
    certificate: issued,
    receipt,
    payment,
    netCertified,
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
      descriptionAr: 'أعمال الأساسات',
      items: [
        { code: '01.01', description: 'Excavation in ordinary soil', unit: 'm³', quantity: 1200, unitRate: 45 },
        { code: '01.02', description: 'Reinforced concrete foundations', unit: 'm³', quantity: 480, unitRate: 320 },
      ],
    },
    {
      code: '02',
      description: 'Superstructure Works',
      descriptionAr: 'أعمال الهيكل',
      items: [
        { code: '02.01', description: 'Reinforced concrete columns', unit: 'm³', quantity: 260, unitRate: 410 },
        { code: '02.02', description: 'Blockwork walls, 200mm', unit: 'm²', quantity: 3400, unitRate: 28 },
      ],
    },
  ];

  for (const [sectionIndex, section] of plan.entries()) {
    const created = await post(base, {
      sortOrder: sectionIndex + 1,
      code: section.code,
      description: section.description,
      descriptionAr: section.descriptionAr,
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

function summarize(s) {
  if (config.quiet) return;
  const line = '─'.repeat(74);
  console.log(`\n${line}`);
  console.log('Scenario ready\n');
  console.log(`  Project      ${s.project.code}  ${s.project.name}`);
  console.log(`  Client       ${s.client.code}  ${s.client.name}`);
  console.log(`  Contract     ${s.contract.contractNumber}  (ACTIVE)`);
  console.log(`  Application  ${s.ipa.applicationRef ?? s.ipa.id}  (${s.ipa.status})`);
  console.log(`  Certificate  ${s.certificate.certificateRef ?? s.certificate.id}  (${s.certificate.status})`);
  console.log(`  Receipt      ${s.receipt.reference}  ${s.receipt.amount} ${s.receipt.currency}\n`);
  console.log(`  Gross certified   ${s.certificate.totalCertifiedAmount} USD`);
  console.log(`  Deductions        ${s.certificate.totalDeductions} USD`);
  console.log(`  Net certified     ${s.certificate.netCertified} USD`);
  console.log(`  Allocated         ${s.payment.totalAllocated} USD  →  ${s.payment.status}`);

  if (s.payment.status !== 'PAID') {
    console.log(
      `\n  ⚠  The receipt settles the certificate in full, yet the API reports\n` +
        `     ${s.payment.status}. Payment status is measured against GROSS certifiedTotal\n` +
        `     rather than net (C7, issue #11). Expected until that is fixed.`,
    );
  }

  console.log(`\n  Open:  http://acco.localhost:3000/projects/${s.project.id}`);
  console.log(`${line}\n`);
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
const isCli = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));

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
