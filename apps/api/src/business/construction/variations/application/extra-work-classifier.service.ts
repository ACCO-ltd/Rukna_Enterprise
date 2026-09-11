import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import type { BoqNode } from '@prisma/client';
import { PERMISSIONS, type RequestIdentity, type VariationOrderResponse } from '@erp/types';

import { BoqTreeService } from '../../boq/application/boq-tree.service.js';
import { VariationOrderService } from './variation-order.service.js';
import type { AddExtraWorkDto } from '../presentation/dto/add-extra-work.dto.js';

/**
 * The extra-work classifier — ADR-029 CONST-BOQ-029 / spec E-1..E-4.
 *
 * A single `addExtraWork(lines, treatment)` on a COMMITTED BOQ that classifies post-commit scope by
 * WHO PAYS / HOW. It is the one orchestrator that fans the same priced lines to three destinations:
 *
 *   - ABSORB    → an ABSORBED BOQ leaf per line, each funded net-zero by an equal contingency draw
 *                 (BoqTreeService.addAbsorbedScope). Contract value unchanged; contingency ticks down.
 *   - SEPARATE  → a SEPARATE_CHARGE BOQ leaf per line, added in place and EXCLUDED from the in-contract
 *                 total (BoqTreeService.addSeparateChargeLine). Contract value unchanged; total client
 *                 revenue rises (the one-off billing object is R7 — see the seam in BoqTreeService).
 *   - VARIATION → one pre-priced DRAFT VariationOrder from the lines, via the EXISTING ADR-026 create
 *                 flow (VariationOrderService.create). NO BOQ nodes are added — variation nodes are
 *                 materialized only on adopt (R6, not built here). Contract value unchanged until adopt.
 *
 * MODULE BOUNDARY (spec §"Module boundary"): this orchestrator lives in VariationsModule because
 * VariationsModule → BoqModule already exists (for appendVariationNodes). BOQ therefore must NOT
 * depend on Variations — that would be a cycle. Putting the classifier here lets it call
 * BoqTreeService (imported) for ABSORB/SEPARATE and VariationOrderService (local) for VARIATION with
 * no forwardRef and no cycle.
 *
 * AUTH (spec §"Auth", A-4): each treatment needs a DIFFERENT existing permission (ABSORB draw =
 * `manage-contingency:boq`; SEPARATE/scope add = `manage:boq`; VARIATION create = commercial
 * `contractsManage`). `@RequirePermissions` is AND-semantics and cannot vary by request body, so the
 * route only gates the read-surface (`view:boq`) and the per-branch permission is enforced HERE from
 * `identity.permissions` — the same in-service check pattern the commercial read models already use.
 * No NEW permission is added: the fine-grained edit-scope:boq / bill-separately capability tiers are R8.
 */
@Injectable()
export class ExtraWorkClassifierService {
  constructor(
    private readonly boqTree: BoqTreeService,
    private readonly variationOrders: VariationOrderService,
  ) {}

  async addExtraWork(
    identity: RequestIdentity,
    projectId: string,
    dto: AddExtraWorkDto,
  ): Promise<
    | { treatment: 'ABSORB' | 'SEPARATE'; nodes: BoqNode[] }
    | { treatment: 'VARIATION'; variation: VariationOrderResponse }
  > {
    switch (dto.treatment) {
      case 'ABSORB': {
        // E-1 — an ABSORBED leaf per line, each funded net-zero from contingency in one transaction.
        this.require(identity, PERMISSIONS.boqManageContingency);
        const versionId = await this.boqTree.getOperationalVersionId(identity, projectId);
        const nodes: BoqNode[] = [];
        for (const line of dto.lines) {
          nodes.push(
            await this.boqTree.addAbsorbedScope(identity, projectId, versionId, {
              ...(line.parentId ? { parentId: line.parentId } : {}),
              ...(line.code ? { code: line.code } : {}),
              description: line.description,
              ...(line.unit ? { unit: line.unit } : {}),
              amount: line.amount,
            }),
          );
        }
        return { treatment: 'ABSORB', nodes };
      }

      case 'SEPARATE': {
        // E-3 — a SEPARATE_CHARGE leaf per line, added in place (pin-neutral: excluded from the total).
        // Reuses manage:boq for the scope add (edit-scope:boq + bill-separately are R8).
        this.require(identity, PERMISSIONS.boqManage);
        const versionId = await this.boqTree.getOperationalVersionId(identity, projectId);
        const nodes: BoqNode[] = [];
        for (const line of dto.lines) {
          nodes.push(
            await this.boqTree.addSeparateChargeLine(identity, projectId, versionId, {
              ...(line.parentId ? { parentId: line.parentId } : {}),
              ...(line.code ? { code: line.code } : {}),
              description: line.description,
              isLeaf: true,
              ...(line.unit ? { unit: line.unit } : {}),
              quantity: '1',
              unitRate: line.amount,
            }),
          );
        }
        return { treatment: 'SEPARATE', nodes };
      }

      case 'VARIATION': {
        // E-2 — a pre-priced DRAFT VariationOrder via the EXISTING ADR-026 create flow. NO BOQ nodes
        // are added; that happens only on adopt (R6). Each line is a lump sum (quantity 1 × amount).
        this.require(identity, PERMISSIONS.contractsManage);
        if (!dto.contractId) {
          throw new BadRequestException(
            'A contractId is required to raise a client variation: a project may have several contracts, so it cannot be inferred.',
          );
        }
        const variation = await this.variationOrders.create(identity, dto.contractId, {
          title: dto.variationTitle ?? 'Client variation',
          lines: dto.lines.map((line) => ({
            description: line.description,
            quantity: 1,
            unitRate: Number(line.amount),
          })),
        });
        return { treatment: 'VARIATION', variation };
      }

      default: {
        // Exhaustive — the DTO's @IsIn already rejects anything else at the boundary.
        throw new BadRequestException(`Unknown extra-work treatment '${String(dto.treatment)}'.`);
      }
    }
  }

  /** Per-branch RBAC (the route-level guard is only the read surface — see the class comment). */
  private require(identity: RequestIdentity, permission: string): void {
    if (!identity.permissions.includes(permission)) {
      throw new ForbiddenException(`Missing required permission '${permission}'.`);
    }
  }
}
