import { resolve } from 'node:path';

export const SCENARIO_PATH = resolve(process.cwd(), 'e2e/.scenario.json');

/** Stable record identifiers produced by the real-API scenario seeder. */
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
  netCertified: string;
}
