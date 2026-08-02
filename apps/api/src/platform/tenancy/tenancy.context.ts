import { AsyncLocalStorage } from 'async_hooks';
import { PrismaClient } from '@prisma/client';

// Populated by TenancyMiddleware before the request reaches any guard or handler.
// Carries only the tenant-level identity — no user data.
export interface TenantContext {
  tenantId: string;
  tenantSlug: string;
  client: PrismaClient;
}

export const tenancyStorage = new AsyncLocalStorage<TenantContext>();
