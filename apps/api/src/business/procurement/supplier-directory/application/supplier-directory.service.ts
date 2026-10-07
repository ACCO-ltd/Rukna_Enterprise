import { Injectable } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';
import type { SupplierStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { SupplierDirectoryRepository } from '../infrastructure/supplier-directory.repository.js';
import { canSeeProcurementMoney } from '../../shared/procurement-money.js';

export interface SupplierDirectoryRow {
  id: string;
  code: string;
  name: string;
  status: SupplierStatus;
  primaryContact: { name: string; phone: string | null } | null;
  paymentTermsDays: number | null;
  defaultCurrency: string | null;
  /** Purchase orders in status OPEN. */
  openOrderCount: number;
  /**
   * Outstanding on posted bills when they are all in one currency ("0.00" when none). Null when
   * money is hidden from the caller, or when the balance spans currencies (see payableBalances).
   */
  payableBalance: string | null;
  /** Outstanding on posted bills per currency; null when money is hidden from the caller. */
  payableBalances: Array<{ currencyCode: string; amount: string }> | null;
  moneyVisible: boolean;
}

/**
 * The supplier directory for procurement (`GET /procurement/suppliers`, view:procurement) — the
 * accounting `GET /suppliers` is a payables-management surface procurement roles do not hold.
 * Supplier has no "type" field in the schema, so none is returned.
 */
@Injectable()
export class SupplierDirectoryService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: SupplierDirectoryRepository,
  ) {}

  async list(
    identity: RequestIdentity,
    filters: { status?: SupplierStatus; search?: string } = {},
  ): Promise<SupplierDirectoryRow[]> {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const moneyVisible = canSeeProcurementMoney(identity);

    const suppliers = await this.repo.findSuppliers(prisma, orgId, filters);
    const ids = suppliers.map((s) => s.id);
    const [openCounts, balances] = await Promise.all([
      this.repo.openOrderCounts(prisma, orgId, ids),
      moneyVisible ? this.repo.payableBalances(prisma, orgId, ids) : Promise.resolve([]),
    ]);

    const balancesBySupplier = new Map<string, Array<{ currencyCode: string; amount: string }>>();
    for (const b of balances) {
      const list = balancesBySupplier.get(b.supplierId) ?? [];
      list.push({ currencyCode: b.currencyCode, amount: new Decimal(b.amount?.toString() ?? '0').toFixed(2) });
      balancesBySupplier.set(b.supplierId, list);
    }

    return suppliers.map((s) => {
      const perCurrency = (balancesBySupplier.get(s.id) ?? []).filter((b) => !new Decimal(b.amount).isZero());
      const contact = s.contacts[0];
      return {
        id: s.id,
        code: s.code,
        name: s.name,
        status: s.status,
        primaryContact: contact ? { name: contact.name, phone: contact.phone } : null,
        paymentTermsDays: s.paymentTermsDays,
        defaultCurrency: s.defaultCurrency,
        openOrderCount: openCounts.get(s.id) ?? 0,
        payableBalance: !moneyVisible
          ? null
          : perCurrency.length === 0
            ? '0.00'
            : perCurrency.length === 1
              ? perCurrency[0].amount
              : null,
        payableBalances: moneyVisible ? perCurrency : null,
        moneyVisible,
      };
    });
  }
}
