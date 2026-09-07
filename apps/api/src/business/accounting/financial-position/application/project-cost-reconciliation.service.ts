import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { ProjectCostReconciliationResponse, RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { ProjectFinancialPositionRepository } from '../infrastructure/project-financial-position.repository.js';

/**
 * Does procurement's ACTUAL agree with the general ledger?
 *
 * Every figure in the Finance workspace is a claim that these two agree. They are written
 * by different code from different sources — the commitment ledger from the matched
 * purchase-order line, the GL from the supplier bill's journal — so "they agree" has to
 * be a displayed fact, not an assumption. A variance here invalidates project cost
 * everywhere else and must be visible rather than silent.
 *
 * **The comparison is source-scoped on purpose.** It is emphatically NOT
 *
 *     procurement ACTUAL == all GL project cost
 *
 * because GL project cost legitimately includes things procurement never sees: payroll,
 * plant and equipment, depreciation, internal charges, manual accruals. Asserting that
 * equality would turn every non-procurement cost into a false alarm — and, worse, would
 * pressure someone into "fixing" it by pushing non-procurement cost into the ledger.
 *
 * So the GL side is restricted to journals raised from supplier bills, and the rest of
 * project cost is reported alongside as its own figure:
 *
 *     total project GL cost = procurement-originated + non-procurement
 */
@Injectable()
export class ProjectCostReconciliationService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: ProjectFinancialPositionRepository,
  ) {}

  async getForProject(
    identity: RequestIdentity,
    projectId: string,
  ): Promise<ProjectCostReconciliationResponse> {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;

    const [ledgerActual, glCost, unattributed] = await Promise.all([
      this.repo.sumLedgerActual(prisma, orgId, projectId),
      this.repo.sumActualCostBySource(prisma, orgId, projectId),
      this.repo.countUnattributedBillLines(prisma, orgId, projectId),
    ]);

    const variance = glCost.fromSupplierBills.minus(ledgerActual);

    return {
      projectId,
      ledgerActual: ledgerActual.toFixed(2),
      glProcurementCost: glCost.fromSupplierBills.toFixed(2),
      glNonProcurementCost: glCost.fromOtherSources.toFixed(2),
      glTotalProjectCost: glCost.fromSupplierBills.plus(glCost.fromOtherSources).toFixed(2),
      variance: variance.toFixed(2),
      // A cent of rounding is not a reconciliation failure; anything larger is.
      reconciled: variance.abs().lessThanOrEqualTo(new Decimal('0.01')),
      /**
       * Posted bill lines for a purchase order that touches this project which reached the
       * GL with no project on them. Each one is project cost that the accounts have lost,
       * and it is the single most likely cause of a variance above.
       */
      unattributedBillLines: unattributed,
      asOf: new Date().toISOString(),
    };
  }
}
