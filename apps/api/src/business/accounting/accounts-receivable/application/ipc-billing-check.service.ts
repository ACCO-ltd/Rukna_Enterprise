import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { ClientInvoiceRepository } from '../infrastructure/client-invoice.repository.js';
import { billedToDate } from '../domain/ipc-invoice-period.policy.js';

/** One contract whose posted IPC invoices bill more than its certificates support. */
export interface IpcOverBilledContract {
  contractId: string;
  contractNumber: string;
  projectId: string;
  clientId: string;
  currencyCode: string;
  /** Net certified to date: the latest effective certificate, gross − all deductions. */
  netCertifiedToDate: string;
  /** Net billed on posted IPC invoices: gross billed − credit notes − deductions netted. */
  netBilled: string;
  /** netBilled − netCertifiedToDate: what a credit note would need to take back (before tax). */
  overBilledBy: string;
  invoiceCount: number;
}

/**
 * ADR-046 §5 — the read-only check behind the cumulative-certificate fix.
 *
 * Before the fix every IPC invoice billed its certificate's cumulative total, so from the second
 * certificate on a contract was billed again for earlier work. This lists each contract whose
 * posted IPC invoices now bill more (net, before tax) than its latest effective certificate
 * certifies, with the difference. It changes nothing: finance reviews each contract and corrects it
 * with a credit note.
 */
@Injectable()
export class IpcBillingCheckService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly repo: ClientInvoiceRepository,
  ) {}

  async findOverBilledContracts(identity: RequestIdentity): Promise<IpcOverBilledContract[]> {
    const prisma = this.tenancyService.getClient();
    const contracts = await this.repo.findIpcBillingByContract(prisma, identity.activeOrganizationId);

    const findings: IpcOverBilledContract[] = [];
    for (const contract of contracts) {
      const latest = contract.latestCertificate;
      const netCertified = latest
        ? latest.deductions.reduce(
            (net, ded) => net.minus(ded.amount.toString()),
            new Decimal(latest.certifiedTotal.toString()),
          )
        : new Decimal(0);

      const billed = billedToDate(
        contract.invoices.map((inv) => ({
          certifiedGrossAmount:
            inv.certifiedGrossAmount === null ? null : new Decimal(inv.certifiedGrossAmount.toString()),
          subtotal: new Decimal(inv.subtotal.toString()),
          retentionAmount: new Decimal(inv.retentionAmount.toString()),
          advanceRecoveryAmount: new Decimal(inv.advanceRecoveryAmount.toString()),
          otherDeductionsAmount: new Decimal(inv.otherDeductionsAmount.toString()),
          creditedNet: inv.creditNotes.reduce(
            (sum, cn) => sum.plus(cn.netAmount.toString()),
            new Decimal(0),
          ),
        })),
      );
      const netBilled = billed.gross.minus(billed.retention).minus(billed.advanceRecovery).minus(billed.other);

      const overBilledBy = netBilled.minus(netCertified);
      if (!overBilledBy.gt(0)) continue;
      findings.push({
        contractId: contract.id,
        contractNumber: contract.contractNumber,
        projectId: contract.projectId,
        clientId: contract.clientId,
        currencyCode: contract.currency,
        netCertifiedToDate: netCertified.toFixed(2),
        netBilled: netBilled.toFixed(2),
        overBilledBy: overBilledBy.toFixed(2),
        invoiceCount: contract.invoices.length,
      });
    }
    return findings.sort((a, b) => new Decimal(b.overBilledBy).comparedTo(a.overBilledBy));
  }
}
