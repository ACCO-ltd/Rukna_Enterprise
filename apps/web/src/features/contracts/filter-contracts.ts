import type { ContractStatus } from '@erp/types';

import type { Contract } from './types';

export interface ContractFilters {
  status: ContractStatus | 'ALL';
}

/**
 * Filters the contract list in the browser.
 *
 * `GET /contracts` accepts only `projectId` — no search, no status parameter, no
 * pagination — so the project scope is applied server-side (it is the one filter the API
 * offers) and everything else here, against the cached array.
 *
 * Text search is the list grid's own, over the row's columns (contract number, value, billing
 * model, dates). The project and client names are NOT on a row — `GET /contracts` returns bare
 * rows with `projectId` and `clientId` but no expansion — so they cannot be searched without one
 * detail fetch per contract. Adding those names to the list response is worth asking for before
 * pretending to search on them.
 */
export function filterContracts(contracts: Contract[], filters: ContractFilters): Contract[] {
  if (filters.status === 'ALL') return contracts;
  return contracts.filter((contract) => contract.status === filters.status);
}
