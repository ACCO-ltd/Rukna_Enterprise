import { NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';

import { TenancyMiddleware } from './tenancy.middleware.js';
import type { TenancyService } from './tenancy.service.js';

describe('TenancyMiddleware', () => {
  const buildMiddleware = (env: Record<string, string | undefined>) => {
    const resolveTenant = jest.fn().mockImplementation((slug: string) =>
      Promise.resolve({ slug, prisma: {} }),
    );
    const config = {
      get: (key: string) => env[key],
    } as unknown as ConfigService;

    const middleware = new TenancyMiddleware(
      { resolveTenant } as unknown as TenancyService,
      config,
    );

    return { middleware, resolveTenant };
  };

  const run = async (
    middleware: TenancyMiddleware,
    hostname: string,
  ): Promise<{ nextCalled: boolean }> => {
    let nextCalled = false;
    await middleware.use({ hostname } as Request, {} as Response, () => {
      nextCalled = true;
    });
    return { nextCalled };
  };

  describe('without TENANT_ROOT_DOMAIN (existing behaviour)', () => {
    it('resolves the tenant from the first hostname label', async () => {
      const { middleware, resolveTenant } = buildMiddleware({});

      const { nextCalled } = await run(middleware, 'acco.localhost');

      expect(resolveTenant).toHaveBeenCalledWith('acco');
      expect(nextCalled).toBe(true);
    });

    it.each(['www', 'api'])('rejects the reserved subdomain %s', async (sub) => {
      const { middleware } = buildMiddleware({});

      await expect(run(middleware, `${sub}.rukna.app`)).rejects.toThrow(NotFoundException);
    });

    it('rejects a bare hostname with no subdomain', async () => {
      const { middleware } = buildMiddleware({});

      await expect(run(middleware, 'localhost')).rejects.toThrow(NotFoundException);
    });
  });

  describe('with TENANT_ROOT_DOMAIN', () => {
    const env = { TENANT_ROOT_DOMAIN: 'rukna.app' };

    it('resolves a single label beneath the root domain', async () => {
      const { middleware, resolveTenant } = buildMiddleware(env);

      await run(middleware, 'acco.rukna.app');

      expect(resolveTenant).toHaveBeenCalledWith('acco');
    });

    it('ignores an unrelated host rather than inventing a slug from it', async () => {
      const { middleware } = buildMiddleware(env);

      await expect(run(middleware, 'erp-api-production.up.railway.app')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('ignores a nested subdomain beneath the root domain', async () => {
      const { middleware } = buildMiddleware(env);

      await expect(run(middleware, 'a.b.rukna.app')).rejects.toThrow(NotFoundException);
    });

    it('ignores the root domain itself', async () => {
      const { middleware } = buildMiddleware(env);

      await expect(run(middleware, 'rukna.app')).rejects.toThrow(NotFoundException);
    });
  });

  describe('with DEFAULT_TENANT_SLUG', () => {
    it('falls back when the host carries no tenant subdomain', async () => {
      const { middleware, resolveTenant } = buildMiddleware({
        TENANT_ROOT_DOMAIN: 'rukna.app',
        DEFAULT_TENANT_SLUG: 'acco',
      });

      const { nextCalled } = await run(middleware, 'erp-api-production.up.railway.app');

      expect(resolveTenant).toHaveBeenCalledWith('acco');
      expect(nextCalled).toBe(true);
    });

    it('still prefers a real subdomain over the fallback', async () => {
      const { middleware, resolveTenant } = buildMiddleware({
        TENANT_ROOT_DOMAIN: 'rukna.app',
        DEFAULT_TENANT_SLUG: 'acco',
      });

      await run(middleware, 'other.rukna.app');

      expect(resolveTenant).toHaveBeenCalledWith('other');
    });

    it('never reads the tenant from a request header (ARCH-MT-002)', async () => {
      const { middleware } = buildMiddleware({ TENANT_ROOT_DOMAIN: 'rukna.app' });

      const req = {
        hostname: 'erp-api-production.up.railway.app',
        headers: { 'x-tenant-slug': 'victim' },
      } as unknown as Request;

      await expect(
        middleware.use(req, {} as Response, () => undefined),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
