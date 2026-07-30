import { Injectable, NestMiddleware, NotFoundException, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TenancyService } from './tenancy.service.js';
import { tenancyStorage } from './tenancy.context.js';

@Injectable()
export class TenancyMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenancyMiddleware.name);

  constructor(private readonly tenancyService: TenancyService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const slug = this.extractSlug(req.hostname);

    if (!slug) {
      throw new NotFoundException('Could not resolve tenant from hostname');
    }

    const context = await this.tenancyService.resolveTenant(slug);

    tenancyStorage.run(context, () => next());
  }

  private extractSlug(hostname: string): string | null {
    const parts = hostname.split('.');
    if (parts.length < 2) return null;
    const sub = parts[0];
    if (sub === 'www' || sub === 'api') return null;
    return sub;
  }
}
