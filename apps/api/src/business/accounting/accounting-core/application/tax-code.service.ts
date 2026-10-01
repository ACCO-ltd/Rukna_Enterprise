import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { PrismaClient, TaxCode, TaxDirection } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { TaxCodeRepository } from '../infrastructure/tax-code.repository.js';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/** `TaxCode.code` is VARCHAR(10): capitals, digits, `_` and `.` (for a rate such as 12.5). */
export const TAX_CODE_PATTERN = /^[A-Z0-9_.]{1,10}$/;

export interface TaxCodeView {
  id: string;
  code: string;
  name: string;
  /** Percent, as a string — "5", "0", "12.5". */
  ratePercent: string;
  direction: TaxDirection;
  status: 'ACTIVE' | 'INACTIVE' | 'SUPERSEDED';
  effectiveFrom: string;
  effectiveTo: string | null;
  /** The organisation's default sales tax code — what an invoice uses unless Finance picks another. */
  isDefault: boolean;
}

export interface TaxCodesView {
  codes: TaxCodeView[];
  defaultOutputTaxCodeId: string | null;
}

export interface CreateTaxCodeInput {
  code: string;
  name: string;
  ratePercent: string;
  direction: TaxDirection;
  effectiveFrom?: string;
}

/** The tax an invoice is raised at: the code and its rate (percent), snapshotted onto the invoice. */
export interface ResolvedInvoiceTax {
  taxCodeId: string;
  ratePercent: Decimal;
}

const dateOnly = (d: Date | string) => (typeof d === 'string' ? d : d.toISOString()).slice(0, 10);

const notConfigured = (message: string) =>
  new ConflictException({ errorCode: 'TAX_NOT_CONFIGURED', message });
const notApplicable = (message: string) =>
  new UnprocessableEntityException({ errorCode: 'TAX_CODE_NOT_APPLICABLE', message });

/**
 * ADR-041 — tax codes Finance maintains, and the one rule for which code a client invoice is raised
 * at. A code's rate never changes once created: a new rate is a new code made the default, so an
 * invoice and the code it names always agree.
 */
@Injectable()
export class TaxCodeService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: TaxCodeRepository,
  ) {}

  async list(identity: RequestIdentity): Promise<TaxCodesView> {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const [codes, defaultId] = await Promise.all([
      this.repo.findAll(prisma, orgId),
      this.repo.findDefaultOutputId(prisma, orgId),
    ]);
    return { codes: codes.map((c) => present(c, defaultId)), defaultOutputTaxCodeId: defaultId };
  }

  async create(identity: RequestIdentity, input: CreateTaxCodeInput): Promise<TaxCodesView> {
    const prisma = this.tenancy.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const code = input.code.trim().toUpperCase();
    const name = input.name.trim();
    if (!TAX_CODE_PATTERN.test(code)) {
      throw new BadRequestException({
        errorCode: 'TAX_CODE_INVALID',
        message: 'Code must be 1–10 characters: A–Z, 0–9, "_" or "."',
      });
    }
    if (!name) throw new BadRequestException({ errorCode: 'TAX_CODE_NAME_REQUIRED', message: 'Name is required' });
    const rate = parseRate(input.ratePercent);
    const effectiveFrom = input.effectiveFrom ? parseDate(input.effectiveFrom) : parseDate(dateOnly(new Date()));

    if (await this.repo.findByCode(prisma, orgId, code)) throw codeTaken(code);
    try {
      await prisma.$transaction(async (tx) => {
        const created = await this.repo.create(tx, {
          organizationId: orgId, code, name, ratePercent: rate, direction: input.direction, effectiveFrom, createdBy: userId,
        });
        await this.repo.recordAudit(tx, {
          organizationId: orgId, userId, action: 'TAX_CODE_CREATED', resourceId: created.id,
          after: { code, name, ratePercent: rate.toString(), direction: input.direction, effectiveFrom: dateOnly(effectiveFrom) },
          sourceCommand: 'tax-code.create',
        });
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') throw codeTaken(code);
      throw err;
    }
    return this.list(identity);
  }

  async setActive(identity: RequestIdentity, id: string, active: boolean): Promise<TaxCodesView> {
    const prisma = this.tenancy.getClient();
    const { activeOrganizationId: orgId, userId } = identity;
    const code = await this.repo.findById(prisma, orgId, id);
    if (!code) throw new NotFoundException(`Tax code ${id} not found`);

    const next = active ? 'ACTIVE' : 'INACTIVE';
    if (code.status === next) return this.list(identity);
    if (!active && (await this.repo.findDefaultOutputId(prisma, orgId)) === id) {
      throw new ConflictException({
        errorCode: 'TAX_CODE_IS_DEFAULT',
        message: `${code.code} is the default sales tax. Choose another default before deactivating it.`,
      });
    }
    await prisma.$transaction(async (tx) => {
      await this.repo.setStatus(tx, id, next);
      await this.repo.recordAudit(tx, {
        organizationId: orgId, userId, action: active ? 'TAX_CODE_REACTIVATED' : 'TAX_CODE_DEACTIVATED',
        resourceId: id, before: { status: code.status }, after: { status: next },
        sourceCommand: active ? 'tax-code.reactivate' : 'tax-code.deactivate',
      });
    });
    return this.list(identity);
  }

  async setDefaultOutput(identity: RequestIdentity, taxCodeId: string): Promise<TaxCodesView> {
    const prisma = this.tenancy.getClient();
    const { activeOrganizationId: orgId, userId } = identity;
    const code = await this.repo.findById(prisma, orgId, taxCodeId);
    if (!code) throw new NotFoundException(`Tax code ${taxCodeId} not found`);
    if (code.direction !== 'OUTPUT' || code.status !== 'ACTIVE') {
      throw notApplicable(`${code.code} cannot be the default sales tax: it must be an active sales (output) code.`);
    }
    const before = await this.repo.findDefaultOutputId(prisma, orgId);
    if (before === taxCodeId) return this.list(identity);
    await prisma.$transaction(async (tx) => {
      await this.repo.setDefaultOutput(tx, orgId, taxCodeId, userId);
      await this.repo.recordAudit(tx, {
        organizationId: orgId, userId, action: 'TAX_DEFAULT_OUTPUT_CHANGED', resourceId: taxCodeId,
        before: { defaultOutputTaxCodeId: before }, after: { defaultOutputTaxCodeId: taxCodeId, code: code.code },
        sourceCommand: 'tax-code.set-default-output',
      });
    });
    return this.list(identity);
  }

  /**
   * The default sales tax code and its rate, for previews ("Prepare invoice"). `null` when the
   * organisation has none configured — the preview says so instead of guessing a rate.
   */
  async defaultOutput(prisma: TenantPrisma, organizationId: string): Promise<TaxCodeView | null> {
    const defaultId = await this.repo.findDefaultOutputId(prisma, organizationId);
    if (!defaultId) return null;
    const code = await this.repo.findById(prisma, organizationId, defaultId);
    return code ? present(code, defaultId) : null;
  }

  /**
   * ADR-041 §4 — the tax code a client invoice is raised at.
   *
   *  - none asked for → the organisation's default; none configured → 409 TAX_NOT_CONFIGURED
   *  - another code than the default → `manage:accounting` only (403 TAX_CODE_OVERRIDE_FORBIDDEN)
   *  - the code must be ACTIVE, OUTPUT and in force on the invoice date (422 TAX_CODE_NOT_APPLICABLE)
   *
   * There is no fallback rate: an invoice at a rate nobody chose is worse than a clear error.
   */
  async resolveForClientInvoice(
    prisma: TenantPrisma,
    identity: RequestIdentity,
    requestedTaxCodeId: string | null | undefined,
    invoiceDate: Date | string,
  ): Promise<ResolvedInvoiceTax> {
    // Some invoice endpoints take interface DTOs (no class-validator), so the value is checked here.
    if (requestedTaxCodeId !== undefined && requestedTaxCodeId !== null && typeof requestedTaxCodeId !== 'string') {
      throw notApplicable('taxCodeId must be a tax code id');
    }
    const requested = requestedTaxCodeId ? requestedTaxCodeId : undefined;
    const orgId = identity.activeOrganizationId;
    const defaultId = await this.repo.findDefaultOutputId(prisma, orgId);
    const chosenId = requested ?? defaultId;
    if (!chosenId) {
      throw notConfigured('No default sales tax is set. Finance sets it on Accounting → Tax before invoices can be raised.');
    }
    const isOverride = requested !== undefined && requested !== defaultId;
    if (isOverride && !mayOverride(identity)) {
      throw new ForbiddenException({
        errorCode: 'TAX_CODE_OVERRIDE_FORBIDDEN',
        message: 'Only Finance (Manage accounting) can raise an invoice at a tax code other than the default.',
      });
    }

    const code = await this.repo.findById(prisma, orgId, chosenId);
    const day = dateOnly(invoiceDate);
    const problem = !code
      ? 'does not exist'
      : code.direction !== 'OUTPUT'
        ? 'is not a sales (output) tax code'
        : code.status !== 'ACTIVE'
          ? 'is inactive'
          : dateOnly(code.effectiveFrom) > day || (code.effectiveTo !== null && dateOnly(code.effectiveTo) <= day)
            ? `is not in force on ${day}`
            : null;
    if (problem) {
      const label = code?.code ?? chosenId;
      if (!isOverride) {
        throw notConfigured(`The default sales tax ${label} ${problem}. Finance sets a valid default on Accounting → Tax.`);
      }
      throw notApplicable(`Tax code ${label} ${problem}.`);
    }
    return { taxCodeId: code!.id, ratePercent: new Decimal(code!.rate.toString()) };
  }
}

function mayOverride(identity: RequestIdentity): boolean {
  return identity.permissions.includes('*') || identity.permissions.includes(PERMISSIONS.accountingManage);
}

function present(code: TaxCode, defaultId: string | null): TaxCodeView {
  return {
    id: code.id,
    code: code.code,
    name: code.name,
    ratePercent: new Decimal(code.rate.toString()).toString(),
    direction: code.direction,
    status: code.status,
    effectiveFrom: dateOnly(code.effectiveFrom),
    effectiveTo: code.effectiveTo ? dateOnly(code.effectiveTo) : null,
    isDefault: code.id === defaultId,
  };
}

function parseRate(raw: string): Decimal {
  let rate: Decimal;
  try {
    rate = new Decimal(raw.trim());
  } catch {
    throw invalidRate(raw);
  }
  if (!rate.isFinite() || rate.isNegative() || rate.gt(100) || rate.decimalPlaces() > 4) throw invalidRate(raw);
  return rate;
}

function parseDate(iso: string): Date {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException({ errorCode: 'TAX_CODE_DATE_INVALID', message: `"${iso}" is not a valid date` });
  }
  return d;
}

const invalidRate = (raw: string) =>
  new BadRequestException({ errorCode: 'TAX_RATE_INVALID', message: `"${raw}" is not a rate between 0 and 100 (up to 4 decimals)` });

const codeTaken = (code: string) =>
  new ConflictException({ errorCode: 'TAX_CODE_TAKEN', message: `Tax code ${code} already exists` });
