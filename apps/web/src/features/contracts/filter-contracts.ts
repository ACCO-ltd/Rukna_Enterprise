import type { ContractStatus } from '@erp/types';

import type { Contract } from './types';

export interface ContractFilters {
  search: string;
  status: ContractStatus | 'ALL';
}

/**
 * Filters the contract list in the browser.
 *
 * `GET /contracts` accepts only `projectId` — no search, no status parameter, no
 * pagination — so the project scope is applied server-side (it is the one filter the API
 * offers) and everything else here, against the cached array.
 *
 * Search matches the contract number only. That is deliberate rather than lazy: a list row
 * carries the contract number, and the project and client names are NOT on it — `GET
 * /contracts` returns bare rows with `projectId` and `clientId` but no expansion, so
 * searching on a client name would need one detail fetch per contract. Adding those names
 * to the list response is worth asking for before pretending to search on them.
 */
export function filterContracts(contracts: Contract[], filters: ContractFilters): Contract[] {
  const needle = filters.search.trim().toLowerCase();

  return contracts.filter((contract) => {
    if (filters.status !== 'ALL' && contract.status !== filters.status) return false;
    if (!needle) return true;

    return contract.contractNumber.toLowerCase().includes(needle);
  });
}
