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
  receiptId: string;
  receiptReference: string | null;
  ipcId: string;
  /** Net certified on the seeded certificate, as the API reports it. */
  netCertified: string;
}

/**
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
    receiptId: seeded.receipt.id,
    receiptReference: seeded.receipt.reference ?? null,
    ipcId: seeded.certificate.id,
    netCertified: seeded.certificate.netCertified,
  };

  mkdirSync(dirname(SCENARIO_PATH), { recursive: true });
  writeFileSync(SCENARIO_PATH, JSON.stringify(scenario, null, 2), 'utf8');
}

export default globalSetup;
