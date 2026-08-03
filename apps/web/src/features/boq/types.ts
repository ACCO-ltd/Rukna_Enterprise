import { BoqVersionStatus } from '@erp/types';

/**
 * BOQ wire shapes now live in `src/lib/api-types.ts` with every other shape the API
 * returns — one place to check a backend contract, one place to delete when `@erp/types`
 * ships DTOs (B12). Re-exported here so feature code can keep importing from `./types`.
 */
export type { Boq, BoqVersion, BoqTreeNode } from '@/lib/api-types';

export { BoqVersionStatus };
