import { Injectable, NestMiddleware, NotFoundException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, NextFunction } from 'express';
import { TenancyService } from './tenancy.service.js';
import { tenancyStorage } from './tenancy.context.js';

/** Subdomains that address the platform itself, never a tenant. */
const RESERVED_SUBDOMAINS = new Set(['www', 'api']);

@Injectable()
export class TenancyMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenancyMiddleware.name);

  constructor(
    private readonly tenancyService: TenancyService,
    private readonly config: ConfigService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const slug = this.extractSlug(req.hostname) ?? this.defaultSlug();

    if (!slug) {
      throw new NotFoundException('Could not resolve tenant from hostname');
    }

    const context = await this.tenancyService.resolveTenant(slug);

    tenancyStorage.run(context, () => next());
  }

  /**
   * Reads the tenant slug from the request subdomain (ARCH-MT, ADR-001).
   *
   * When TENANT_ROOT_DOMAIN is set, only a single label directly beneath that
   * domain counts — `acco.rukna.app` yields `acco`, while an unrelated host
   * such as a PaaS-generated `my-api.up.railway.app` yields nothing rather
   * than the bogus slug `my-api`.
   */
  private extractSlug(hostname: string): string | null {
    const rootDomain = this.config.get<string>('TENANT_ROOT_DOMAIN')?.trim();

    if (rootDomain) {
      const suffix = `.${rootDomain}`;
      if (!hostname.endsWith(suffix)) return null;
      const sub = hostname.slice(0, -suffix.length);
      if (!sub || sub.includes('.')) return null;
      return RESERVED_SUBDOMAINS.has(sub) ? null : sub;
    }

    const parts = hostname.split('.');
    if (parts.length < 2) return null;
    const sub = parts[0];
    if (!sub || RESERVED_SUBDOMAINS.has(sub)) return null;
    return sub;
  }

  /**
   * Single-tenant fallback for hosts that carry no tenant subdomain.
   *
   * Server-side configuration only — deliberately never read from a request
   * header, which would let a caller select another tenant (ARCH-MT-002).
   */
  private defaultSlug(): string | null {
    const slug = this.config.get<string>('DEFAULT_TENANT_SLUG')?.trim();
    if (!slug) return null;
    this.logger.debug(`No tenant subdomain on request; using DEFAULT_TENANT_SLUG=${slug}`);
    return slug;
  }
}
