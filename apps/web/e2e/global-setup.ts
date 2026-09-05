import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// A plain JS module — TypeScript infers its shape from the implementation.
import { seedScenario } from '../tools/seed-scenario.mjs';

export const SCENARIO_PATH = resolve(process.cwd(), 'e2e/.scenario.json');

/** The records the suite navigates to. Ids only — figures are read from the screens. */
export interface Scenario {
  clientId: string;
  clientName: string;
  projectId: string;
  contractId: string;
  contractNumber: string;
  ipaId: string;
  ipaRef: string | null;
  certificationIpaId: string;
  receiptId: string;
  receiptReference: string | null;
  ipcId: string;
  /** Net certified on the seeded certificate, as the API reports it. */
  netCertified: string;
}

/**
 * ─── Environment prerequisites (not application defects) ─────────────────────────
 *
 * The scenario drives the real endpoints, so it inherits the tenant's configuration. Two things
 * must be true of the target tenant or seeding stops part-way:
 *
 *  1. **An active workflow binding for `InterimPaymentApplication` DRAFT → PENDING_INTERNAL_APPROVAL.**
 *     Without it `POST /ipa/:id/submit-for-approval` answers 422 by design — a REQUIRED governed
 *     transition with no chain configured is refused, not waved through. The seeder currently
 *     depends on that binding existing rather than creating it; making the scenario seed its own
 *     governance bindings would make the test environment reproducible instead of borrowing
 *     whatever the tenant happens to have.
 *  2. **An accounting foundation** — chart of accounts, a fiscal year with an open period, and
 *     posting configuration — for anything that posts to the GL. Absent it,
 *     `POST /invoices/:id/post` answers `POSTING_ACCOUNT_NOT_CONFIGURED`.
 *
 * Both are configuration gaps. A spec that brings its own data should set `E2E_SKIP_SEED=1`
 * rather than wait for either to be fixed.
 *
 * Seeds a complete billing scenario before the suite runs.
 *
 * The alternative — asserting against whatever is already in the database — makes a test
 * that passes or fails for reasons unrelated to the code. Seeding costs one HTTP round of
 * about twenty calls and makes every assertion below deterministic.
 *
 * The ids go to a file rather than a module export because Playwright's global setup runs
 * in a separate process from the tests.
 */
async function globalSetup(): Promise<void> {
  // Some specs bring their own data and assert against it — the Commercial QA gate is one.
  // For those, seeding is not just wasted time: the scenario walks the whole IPA→IPC→receipt
  // chain, so it dies in any tenant missing a workflow binding and takes every unrelated spec
  // down with it before a single browser opens.
  if (process.env['E2E_SKIP_SEED'] === '1') return;

  // Quiet: the reporter owns stdout, and a machine-readable report must not be interleaved
  // with the seeder's progress log.
  const seeded = await seedScenario({ quiet: true });

  const scenario: Scenario = {
    clientId: seeded.client.id,
    clientName: seeded.client.name,
    projectId: seeded.project.id,
    contractId: seeded.contract.id,
    contractNumber: seeded.contract.contractNumber,
    ipaId: seeded.ipa.id,
    ipaRef: seeded.ipa.applicationRef ?? null,
    certificationIpaId: seeded.certificationIpa.id,
    receiptId: seeded.receipt.id,
    receiptReference: seeded.receipt.reference ?? null,
    ipcId: seeded.certificate.id,
    netCertified: seeded.certificate.netCertified,
  };

  mkdirSync(dirname(SCENARIO_PATH), { recursive: true });
  writeFileSync(SCENARIO_PATH, JSON.stringify(scenario, null, 2), 'utf8');
}

export default globalSetup;
