import { AsyncLocalStorage } from 'async_hooks';
import { PrismaClient } from '@prisma/client';

export interface TenancyContext {
  slug: string;
  orgId: string;
  client: PrismaClient;
  lang: 'en' | 'ar';
}

export const tenancyStorage = new AsyncLocalStorage<TenancyContext>();
