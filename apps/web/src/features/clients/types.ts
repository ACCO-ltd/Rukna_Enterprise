import { ClientStatus } from '@erp/types';

/**
 * Client wire shapes live in `src/lib/api-types.ts` with every other shape the API
 * returns — one place to check a backend contract, one place to delete when `@erp/types`
 * ships DTOs (B12). Re-exported here so feature code can import from `./types`.
 */
export type { Client, ClientDetail, ClientContact, ClientListItem } from '@/lib/api-types';

export { ClientStatus };

/** Status order for the filter dropdown. Only two states exist. */
export const CLIENT_STATUS_ORDER: ClientStatus[] = [ClientStatus.ACTIVE, ClientStatus.INACTIVE];
