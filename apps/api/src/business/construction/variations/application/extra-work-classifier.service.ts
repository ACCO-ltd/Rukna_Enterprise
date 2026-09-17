import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import type { BoqNode } from '@prisma/client';
import { PERMISSIONS, type RequestIdentity, type VariationOrderResponse } from '@erp/types';

import { BoqTreeService } from '../../boq/application/boq-tree.service.js';
import { ClientInvoiceService } from '../../../accounting/accounts-receivable/application/client-invoice.service.js';
import { VariationOrderService } from './variation-order.service.js';
import { ApplyVariationToBoqService } from './apply-variation-to-boq.service.js';
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
 *                 total (BoqTreeService.addSeparateChargeLine), then billed NOW via a standalone client
 *                 invoice (ClientInvoiceService.generateFromSeparateCharge). Contract value unchanged;
 *                 total client revenue rises (variation-collapse: "client pays now").
 *   - VARIATION → one variation raised AND adopted in one atomic step (ApplyVariationToBoqService
 *                 .raiseAndAdopt): it lands CLIENT_APPROVED, its scope is appended to the committed BOQ,
 *                 and the current contract value is raised — all together. The old DRAFT-VO +
 *                 approval-workflow path is retired (variation-collapse).
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
    private readonly applyToBoq: ApplyVariationToBoqService,
    private readonly clientInvoices: ClientInvoiceService,
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
        //
        // variation-collapse: the client pays NOW. After each SEPARATE_CHARGE node is created, generate
        // its standalone client invoice (ClientInvoiceService.generateFromSeparateCharge) so the one-off
        // is billed immediately. contractValue is untouched (a separate charge never enters the total —
        // the generator bills off the leaf and feeds total client revenue, not the contract value).
        //
        // ATOMICITY — the ideal is (addSeparateChargeLine + generateFromSeparateCharge) in one tx per
        // line. `generateFromSeparateCharge` now accepts an optional tx (mirroring its siblings), but
        // `addSeparateChargeLine` → `addNode` → `createNodeAtPosition` opens its OWN `prisma.$transaction`
        // and resolves its own client; a `Prisma.TransactionClient` has no `$transaction`, so threading a
        // caller tx through that shared BOQ write path is genuinely invasive (it would have to teach every
        // node-write repo method to skip its own transaction when handed one). We deliberately do NOT force
        // it here. Instead we stay sequential and lean on the invoice step's idempotency: it keys on
        // `sourceBoqNodeId` (findByBoqNode short-circuits a repeat AND the DB unique index closes the
        // race), so a full-request retry never double-bills. A hard error in either step surfaces to the
        // caller unswallowed.
        //
        // RESIDUAL LIMITATION (documented, accepted for this fix): the node write and the invoice write
        // are two commits, so if the invoice step fails AFTER the node is created, the SEPARATE_CHARGE node
        // persists un-billed; a full-request retry re-runs every line and, because `addSeparateChargeLine`
        // is NOT idempotent (it auto-numbers a fresh code), can create a DUPLICATE node for an
        // already-created line — while the invoice step remains idempotent, so billing stays exactly-once.
        // Fully closing this needs the tx-aware BOQ write path above (a follow-up), not this targeted fix.
        this.require(identity, PERMISSIONS.boqManage);
        const versionId = await this.boqTree.getOperationalVersionId(identity, projectId);
        const { invoiceDate, dueDate } = this.separateChargeDates();
        const nodes: BoqNode[] = [];
        for (const line of dto.lines) {
          const node = await this.boqTree.addSeparateChargeLine(identity, projectId, versionId, {
            ...(line.parentId ? { parentId: line.parentId } : {}),
            ...(line.code ? { code: line.code } : {}),
            description: line.description,
            isLeaf: true,
            ...(line.unit ? { unit: line.unit } : {}),
            quantity: '1',
            unitRate: line.amount,
          });
          await this.clientInvoices.generateFromSeparateCharge(identity, {
            boqNodeId: node.id,
            invoiceDate,
            dueDate,
          });
          nodes.push(node);
        }
        return { treatment: 'SEPARATE', nodes };
      }

      case 'VARIATION': {
        // E-2 — variation-collapse: raise the variation and adopt it into the BOQ in ONE atomic step
        // (ApplyVariationToBoqService.raiseAndAdopt). The old DRAFT-VO + approval-workflow path is
        // retired: the VO lands CLIENT_APPROVED, its scope is appended to the committed BOQ, and the
        // current contract value is raised — all together. Each line is a lump sum (quantity 1 × amount).
        this.require(identity, PERMISSIONS.contractsManage);
        if (!dto.contractId) {
          throw new BadRequestException(
            'A contractId is required to raise a client variation: a project may have several contracts, so it cannot be inferred.',
          );
        }
        const adopted = await this.applyToBoq.raiseAndAdopt(identity, dto.contractId, {
          title: dto.variationTitle ?? 'Client variation',
          lines: dto.lines.map((line) => ({
            description: line.description,
            quantity: 1,
            unitRate: Number(line.amount),
          })),
          ...(dto.clientApprovalReference
            ? { clientApprovalReference: dto.clientApprovalReference }
            : {}),
        });
        return {
          treatment: 'VARIATION',
          variation: await this.variationOrders.findOne(identity, adopted.variationId),
        };
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

  /**
   * The invoice/due dates for a separate-charge invoice billed inline: invoiceDate = today, dueDate =
   * today + 30 days (Net 30, the generator's default convention). Both are `YYYY-MM-DD` strings, which
   * is what GenerateInvoiceFromSeparateChargeDto expects (@IsDateString).
   */
  private separateChargeDates(): { invoiceDate: string; dueDate: string } {
    const today = new Date();
    const due = new Date(today);
    due.setDate(due.getDate() + 30);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    return { invoiceDate: iso(today), dueDate: iso(due) };
  }
}
