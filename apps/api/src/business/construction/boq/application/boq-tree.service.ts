import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  BoqNode,
  MeasurementMethod,
  PricingBasis,
  BoqSourceType,
  CommercialTreatment,
  NodeRole,
  Prisma,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import type { BoqChangeEventResponse, RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import {
  BoqPrismaRepository,
  BoqWithVersions,
  type BoqChangeEventInput,
} from '../infrastructure/boq-prisma.repository.js';
import {
  AMOUNT_SCALE,
  formatAmount,
  formatQuantity,
  lineAmount,
  sumAmounts,
  toDecimal,
  type DecimalString,
} from '../domain/boq-money.js';
import {
  contributesToInContractTotal,
  isContingencyLeaf,
} from '../domain/boq-contract-value.policy.js';
import { MAX_DEPTH, validateNodeWrite } from '../domain/boq-node.policy.js';
import { proposeNodeCode } from '../domain/boq-code.policy.js';
import type { CreateNodeDto } from '../presentation/dto/create-node.dto.js';
import type { UpdateNodeDto } from '../presentation/dto/update-node.dto.js';
import type { MoveNodeDto } from '../presentation/dto/move-node.dto.js';

/**
 * A node as it crosses the wire.
 *
 * Deliberately not `BoqNode & { children }`: the Prisma row leaks `Decimal` objects whose
 * serialization is incidental, and `computedTotal` used to go out as a JSON number while
 * `totalAmount` went out as a string — the same quantity in two representations on one
 * object (B7). Every decimal here is an explicit string, per CONST-BOQ-014.
 */
export interface BoqTreeNodeView {
  id: string;
  boqId: string;
  versionId: string;
  parentId: string | null;
  path: string;
  depth: number;
  sortOrder: number;
  code: string;
  description: string;
  isLeaf: boolean;
  measurementMethod: MeasurementMethod;
  pricingBasis: PricingBasis;
  unit: string | null;
  quantity: DecimalString | null;
  unitRate: DecimalString | null;
  currency: string;
  totalAmount: DecimalString | null;
  originNodeId: string | null;
  sourceType: BoqSourceType;
  sourceChangeOrderId: string | null;
  nodeRole: NodeRole;
  commercialTreatment: CommercialTreatment;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  children: BoqTreeNodeView[];
  /** Leaf: its own amount. Section: the sum of its descendants. Null when unpriced. */
  computedTotal: DecimalString | null;
}

@Injectable()
export class BoqTreeService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly repo: BoqPrismaRepository,
  ) {}

  // ─── Queries ─────────────────────────────────────────────────────────────────

  async getTree(
    identity: RequestIdentity,
    projectId: string,
    versionId: string,
  ): Promise<BoqTreeNodeView[]> {
    const prisma = this.tenancyService.getClient();
    const boq = await this.requireBoqForProject(prisma, projectId, identity.activeOrganizationId);
    this.requireVersionBelongsToBoq(versionId, boq);

    const nodes = await this.repo.findNodesByVersion(prisma, versionId);
    return buildTree(nodes, boq.currency);
  }

  /**
   * The one live operational version for a project's BOQ — ADR-029 L-1. The extra-work classifier
   * (R5) resolves it so the caller names only the project, not an internal version id. Falls back to
   * the legacy draft pointer for a BOQ initialized before R2 backfilled `currentVersionId`.
   */
  async getOperationalVersionId(identity: RequestIdentity, projectId: string): Promise<string> {
    const prisma = this.tenancyService.getClient();
    const boq = await this.requireBoqForProject(prisma, projectId, identity.activeOrganizationId);
    const operationalVersionId = boq.currentVersionId ?? boq.currentDraftVersionId;
    if (!operationalVersionId) {
      throw new NotFoundException(`Project ${projectId} has no operational BOQ version.`);
    }
    return operationalVersionId;
  }

  // ─── Commands ────────────────────────────────────────────────────────────────

  async addNode(
    identity: RequestIdentity,
    projectId: string,
    versionId: string,
    dto: CreateNodeDto,
    // L-5 seam: only the variation command (R6) may raise the committed total. Not on the DTO —
    // an ordinary caller can never set it. `commercialTreatment` is a second server-only seam:
    // the R5 classifier mints SEPARATE_CHARGE / ABSORBED leaves through it (E-1/E-3); it is never
    // on the DTO either, so a plain `manage:boq` add is always IN_CONTRACT (the schema default).
    options: {
      allowContractValueChange?: boolean;
      commercialTreatment?: CommercialTreatment;
    } = {},
  ): Promise<BoqNode> {
    const prisma = this.tenancyService.getClient();
    const boq = await this.requireBoqForProject(prisma, projectId, identity.activeOrganizationId);
    this.requireVersionBelongsToBoq(versionId, boq);
    const status = await this.requireWritableVersion(prisma, versionId);

    let parentPath: string | null = null;
    let parentDepth = -1;
    let parentIsItem = false;
    let parentCode: string | null = null;

    if (dto.parentId) {
      const parent = await this.repo.findNodeById(prisma, dto.parentId);
      if (!parent || parent.versionId !== versionId) {
        throw new NotFoundException(`Parent node ${dto.parentId} not found in this version`);
      }
      parentPath = parent.path;
      parentDepth = parent.depth;
      parentIsItem = parent.isLeaf;
      parentCode = parent.code;
    }

    const isLeaf = dto.isLeaf ?? false;
    const overrideCode = dto.code?.trim();

    // L-5 — a new node defaults to WORK / IN_CONTRACT (schema defaults). The R5 classifier passes a
    // server-only `commercialTreatment` to mint SEPARATE_CHARGE / ABSORBED leaves (E-1/E-3). On a
    // COMMITTED version adding an IN_CONTRACT (or ABSORBED) priced leaf raises the in-contract total
    // and is pinned; a SEPARATE_CHARGE leaf never contributes (contributesToInContractTotal is false
    // for it), so its prospective delta is 0 and it is inherently pin-neutral. A section, an unpriced
    // leaf, or a zero-amount leaf adds nothing and is allowed.
    const commercialTreatment = options.commercialTreatment ?? 'IN_CONTRACT';
    const addedAmount = formatAmount(lineAmount(dto.quantity, dto.unitRate, isLeaf));
    const addedContribution = this.inContractContribution(
      { isLeaf, commercialTreatment },
      addedAmount,
    );
    this.assertPinAllows(
      status,
      toDecimal('0'),
      addedContribution,
      options.allowContractValueChange ?? false,
    );

    // Position: append unless the caller asked for a specific slot. Sibling order is dense
    // and server-owned (CONST-BOQ-017), so an out-of-range request is clamped, not rejected.
    const siblingCount = await this.repo.countSiblings(prisma, versionId, dto.parentId ?? null);
    const targetOrder = Math.max(0, Math.min(dto.sortOrder ?? siblingCount, siblingCount));

    // D2: the server assigns the code from the tree position unless the caller overrode it. If a
    // concurrent add just claimed the generated code (the unique index fires), regenerate and
    // retry; an *overridden* code that collides is the caller's to resolve, so it is not retried.
    for (let attempt = 1; ; attempt += 1) {
      const code =
        overrideCode && overrideCode.length > 0
          ? overrideCode
          : proposeNodeCode(
              isLeaf ? 'item' : 'section',
              parentCode,
              await this.repo.findChildCodes(prisma, versionId, dto.parentId ?? null),
            );

      this.assertValid(
        validateNodeWrite(
          {
            code,
            isLeaf,
            unit: dto.unit,
            quantity: dto.quantity,
            unitRate: dto.unitRate,
            currency: dto.currency,
            depth: parentDepth + 1,
          },
          {
            boqCurrency: boq.currency,
            siblingCodes: await this.repo.findCodesInVersion(prisma, versionId),
            parentIsItem,
            hasChildren: false,
          },
        ),
      );

      try {
        return await this.repo.createNodeAtPosition(
          prisma,
          {
            boqId: boq.id,
            versionId,
            parentId: dto.parentId ?? null,
            path: '',
            depth: parentDepth + 1,
            sortOrder: targetOrder,
            code,
            description: dto.description,
            isLeaf,
            measurementMethod: dto.measurementMethod ?? MeasurementMethod.QUANTITY,
            pricingBasis: dto.pricingBasis ?? PricingBasis.UNIT_RATE,
            unit: isLeaf ? (dto.unit ?? null) : null,
            quantity: isLeaf ? (dto.quantity ?? null) : null,
            unitRate: isLeaf ? (dto.unitRate ?? null) : null,
            // A leaf always carries the BOQ's currency; a section carries none. Storing it makes
            // the IPA rate snapshot self-describing without walking back up to the aggregate.
            currency: isLeaf ? boq.currency : null,
            totalAmount: formatAmount(lineAmount(dto.quantity, dto.unitRate, isLeaf)),
            // Server-only: IN_CONTRACT unless the R5 classifier asked for SEPARATE_CHARGE (E-3).
            // ABSORBED is added through addExtraWork, not this path (it needs a funding draw).
            commercialTreatment,
          },
          parentPath,
          targetOrder,
          {
            ...this.changeBase(identity, boq, versionId),
            code,
            action: 'CREATE',
            detail: isLeaf ? `Added item ${code}` : `Added section ${code}`,
          },
        );
      } catch (error) {
        if (!overrideCode && attempt < 4 && isDuplicateCodeConflict(error)) continue;
        throw error;
      }
    }
  }

  async updateNode(
    identity: RequestIdentity,
    projectId: string,
    versionId: string,
    nodeId: string,
    dto: UpdateNodeDto,
    options: { allowContractValueChange?: boolean } = {},
  ): Promise<BoqNode> {
    const prisma = this.tenancyService.getClient();
    const boq = await this.requireBoqForProject(prisma, projectId, identity.activeOrganizationId);
    this.requireVersionBelongsToBoq(versionId, boq);
    const status = await this.requireWritableVersion(prisma, versionId);

    const node = await this.requireNode(prisma, nodeId, versionId);
    const childCount = await this.repo.countChildren(prisma, nodeId, versionId);

    // The proposed state after the patch, not the patch itself — the rules are about what
    // the node ends up being.
    const isLeaf = dto.isLeaf ?? node.isLeaf;
    const code = dto.code ?? node.code;
    const unit = dto.unit !== undefined ? dto.unit : node.unit;
    const quantity = dto.quantity !== undefined ? dto.quantity : node.quantity?.toString();
    const unitRate = dto.unitRate !== undefined ? dto.unitRate : node.unitRate?.toString();

    this.assertValid(
      validateNodeWrite(
        { code, isLeaf, unit, quantity, unitRate, currency: dto.currency, depth: node.depth },
        {
          boqCurrency: boq.currency,
          siblingCodes: await this.repo.findCodesInVersion(prisma, versionId, nodeId),
          parentIsItem: false,
          hasChildren: childCount > 0,
        },
      ),
    );

    // L-5 — the pin compares this leaf's in-contract contribution before and after the patch.
    // A description/code/measurement edit leaves quantity×rate untouched, so before == after and
    // the write is money-neutral; a rate or quantity change that moves the leaf's amount is pinned
    // on a COMMITTED version. `commercialTreatment` is not editable through this DTO, so it stays
    // the node's own — turning a line into SEPARATE_CHARGE/ABSORBED is the R5 classifier, not here.
    const beforeContribution = this.inContractContribution(node, formatAmount(toDecimal(node.totalAmount)));
    const afterContribution = this.inContractContribution(
      { isLeaf, commercialTreatment: node.commercialTreatment },
      formatAmount(lineAmount(quantity, unitRate, isLeaf)),
    );
    this.assertPinAllows(
      status,
      beforeContribution,
      afterContribution,
      options.allowContractValueChange ?? false,
    );

    const events = this.buildUpdateEvents(identity, boq, node, dto, {
      code,
      isLeaf,
      unit: unit ?? null,
      quantity: quantity ?? null,
      unitRate: unitRate ?? null,
    });

    return this.repo.updateNode(
      prisma,
      nodeId,
      {
        code,
        description: dto.description,
        isLeaf,
        measurementMethod: dto.measurementMethod,
        pricingBasis: dto.pricingBasis,
        unit: isLeaf ? (unit ?? null) : null,
        quantity: isLeaf ? (quantity ?? null) : null,
        unitRate: isLeaf ? (unitRate ?? null) : null,
        currency: isLeaf ? boq.currency : null,
        totalAmount: formatAmount(lineAmount(quantity, unitRate, isLeaf)),
      },
      events,
    );
  }

  async moveNode(
    identity: RequestIdentity,
    projectId: string,
    versionId: string,
    nodeId: string,
    dto: MoveNodeDto,
  ): Promise<BoqTreeNodeView[]> {
    const prisma = this.tenancyService.getClient();
    const boq = await this.requireBoqForProject(prisma, projectId, identity.activeOrganizationId);
    this.requireVersionBelongsToBoq(versionId, boq);
    // A move only reorders/reparents — it never touches an amount, so it is always money-neutral
    // and needs no pin check (L-5). It stays legal on a COMMITTED version (L-6).
    await this.requireWritableVersion(prisma, versionId);

    const node = await this.requireNode(prisma, nodeId, versionId);

    if (dto.newParentId === nodeId) {
      throw new BadRequestException('Cannot move a node to itself.');
    }

    if (dto.newParentId) {
      const newParent = await this.repo.findNodeById(prisma, dto.newParentId);
      if (!newParent || newParent.versionId !== versionId) {
        throw new NotFoundException(`Target parent node ${dto.newParentId} not found`);
      }
      if (newParent.isLeaf) {
        throw new BadRequestException('Cannot move a node under a billable item.');
      }
      if (newParent.path.startsWith(node.path + '/') || newParent.path === node.path) {
        throw new BadRequestException('Cannot move a node to one of its own descendants.');
      }

      // The subtree moves with the node, so it is the deepest descendant that has to fit.
      const subtreeHeight = await this.subtreeHeight(prisma, versionId, node);
      if (newParent.depth + 1 + subtreeHeight > MAX_DEPTH) {
        throw new BadRequestException(
          `This move would exceed the ${MAX_DEPTH + 1}-level BOQ hierarchy limit.`,
        );
      }

      await this.repo.moveNode(
        prisma,
        versionId,
        node,
        dto.newParentId,
        newParent.path,
        newParent.depth,
        dto.newSortOrder,
        this.moveEvent(identity, boq, versionId, node),
      );
    } else {
      await this.repo.moveNode(
        prisma,
        versionId,
        node,
        null,
        null,
        -1,
        dto.newSortOrder,
        this.moveEvent(identity, boq, versionId, node),
      );
    }

    // Returning the tree closes B6 — the endpoint used to answer 200 with an empty body,
    // leaving the client to guess whether anything moved.
    const nodes = await this.repo.findNodesByVersion(prisma, versionId);
    return buildTree(nodes, boq.currency);
  }

  async deleteNode(
    identity: RequestIdentity,
    projectId: string,
    versionId: string,
    nodeId: string,
    options: { allowContractValueChange?: boolean } = {},
  ): Promise<void> {
    const prisma = this.tenancyService.getClient();
    const boq = await this.requireBoqForProject(prisma, projectId, identity.activeOrganizationId);
    this.requireVersionBelongsToBoq(versionId, boq);
    const status = await this.requireWritableVersion(prisma, versionId);

    const node = await this.requireNode(prisma, nodeId, versionId);

    const childCount = await this.repo.countChildren(prisma, nodeId, versionId);
    if (childCount > 0) {
      throw new BadRequestException(
        'Cannot delete a section that has children. Delete or re-parent them first.',
      );
    }

    // L-5 — deleting an IN_CONTRACT leaf removes its contribution and so lowers the total; on a
    // COMMITTED version that is pinned. Deleting an empty section or a non-contributing leaf is
    // money-neutral (after == 0 == before).
    this.assertPinAllows(
      status,
      this.inContractContribution(node, formatAmount(toDecimal(node.totalAmount))),
      toDecimal('0'),
      options.allowContractValueChange ?? false,
    );

    // CONST-BOQ-003. Claims, orders and postings reference nodes by plain string columns,
    // so nothing in the database stops this delete — losing the row would orphan a claimed
    // line and silently change what a certificate was measured against.
    const references = await this.repo.countNodeReferences(prisma, nodeId);
    if (references.length > 0) {
      throw new ConflictException({
        message:
          'This BOQ item is referenced by downstream records and cannot be deleted. Deactivate it instead.',
        details: { nodeId, code: node.code, references },
      });
    }

    await this.repo.deleteNodeAndReindex(prisma, node, {
      ...this.changeBase(identity, boq, versionId),
      nodeId: node.id,
      code: node.code,
      action: 'DELETE',
      detail: node.isLeaf ? `Deleted item ${node.code}` : `Deleted section ${node.code}`,
    });
  }

  /**
   * Draw down the contingency allowance — ADR-029 CONST-BOQ-028 / spec C-3, C-4.
   *
   * Moves `amount` of budget from a CONTINGENCY leaf onto `toNodeId`, in ONE transaction that emits
   * exactly one `MOVE` change event carrying the amount. The in-contract billable total is held
   * EXACTLY constant (contingency −amount, target +amount), so on a COMMITTED version this is a
   * legal money-neutral reallocation (L-5): it reuses the R2 `allowContractValueChange` seam, but
   * the net delta is *asserted* zero here rather than trusted to the flag.
   *
   * Modeling (see the ticket's nuance): a leaf's `totalAmount` is `quantity × unitRate` everywhere
   * in this module, and the tie-out/progress/compare all read that product — a `totalAmount` that
   * disagreed with `quantity × unitRate` would be a visible, machine-detectable lie. To move
   * `amount` onto a target without fabricating a rate or a quantity, both the source contingency
   * leaf and the target MUST be **allowance-style** (`quantity = 1`), so the whole amount lives in
   * `unitRate` and the move is `unitRate ± amount` with no division and no rounding. A measured
   * UNIT_RATE target (quantity ≠ 1) is rejected — there is no distortion-free rate/qty for it, and
   * inventing one is exactly the write this refuses to make. C-4 is served because an ABSORBED line
   * is a lump-sum (quantity = 1) leaf; adding the ABSORBED line itself is the R5 classifier.
   */
  async drawContingency(
    identity: RequestIdentity,
    projectId: string,
    versionId: string,
    toNodeId: string,
    amount: string,
  ): Promise<{ contingencyRemaining: DecimalString | null; inContractTotal: DecimalString | null }> {
    const prisma = this.tenancyService.getClient();
    const boq = await this.requireBoqForProject(prisma, projectId, identity.activeOrganizationId);
    this.requireVersionBelongsToBoq(versionId, boq);
    const status = await this.requireWritableVersion(prisma, versionId);

    const drawAmount = toDecimal(amount);
    // `isPositive()` treats zero as positive in decimal.js, so test strictly greater than zero.
    if (drawAmount === null || drawAmount.isNaN() || !drawAmount.greaterThan(0)) {
      throw new BadRequestException('The draw amount must be a positive number.');
    }

    // The target leaf the draw funds.
    const target = await this.requireNode(prisma, toNodeId, versionId);
    if (!target.isLeaf) {
      throw new BadRequestException('Contingency can only be drawn onto a billable item, not a section.');
    }
    if (isContingencyLeaf(target)) {
      throw new BadRequestException('Cannot draw contingency onto the contingency line itself.');
    }
    if (target.commercialTreatment === 'SEPARATE_CHARGE') {
      // A separate charge is billed outside the contract; funding it from contingency would move
      // the in-contract total down by `amount` with no matching rise, breaking the tie-out.
      throw new BadRequestException(
        'Contingency funds in-contract work; a separate charge is billed outside the contract.',
      );
    }

    // The named allowance. Exactly one contingency leaf is the simple, unambiguous case R4 supports;
    // more than one would need the caller to name the source, which the command deliberately does
    // not expose yet.
    const nodes = await this.repo.findNodesByVersion(prisma, versionId);
    const contingencyLeaves = nodes.filter((node) => isContingencyLeaf(node));
    if (contingencyLeaves.length === 0) {
      throw new BadRequestException('This BOQ has no contingency allowance to draw from.');
    }
    if (contingencyLeaves.length > 1) {
      throw new BadRequestException(
        'This BOQ has more than one contingency line; drawing from a specific pool is not yet supported.',
      );
    }
    const source = contingencyLeaves[0]!;

    // Both sides must be allowance-style (quantity = 1) so `amount` lands exactly on `unitRate`
    // without distorting a rate or a quantity (the modeling nuance above).
    const one = toDecimal('1')!;
    const sourceQty = toDecimal(source.quantity);
    const targetQty = toDecimal(target.quantity);
    if (sourceQty === null || !sourceQty.equals(one)) {
      throw new BadRequestException(
        'The contingency line must be an allowance (quantity 1) to draw from it.',
      );
    }
    if (targetQty === null || !targetQty.equals(one)) {
      throw new BadRequestException(
        'Contingency can only fund an allowance-style item (quantity 1); a measured item would take a distorted rate.',
      );
    }

    // C-3 — over-draw beyond what the allowance holds → 400 CONTINGENCY_EXCEEDED.
    const sourceAmount = toDecimal(source.totalAmount) ?? toDecimal('0')!;
    if (drawAmount.greaterThan(sourceAmount)) {
      throw new BadRequestException({
        message: 'The draw exceeds the contingency remaining on this line.',
        errorCode: 'CONTINGENCY_EXCEEDED',
        details: {
          requested: formatAmount(drawAmount),
          remaining: formatAmount(sourceAmount),
        },
      });
    }

    // The two coordinated leaf amounts after the move — quantity stays 1 on both, so totalAmount
    // tracks unitRate and stays self-consistent.
    const sourceRate = toDecimal(source.unitRate) ?? toDecimal('0')!;
    const targetRate = toDecimal(target.unitRate) ?? toDecimal('0')!;
    const newSourceRate = sourceRate.minus(drawAmount).toDecimalPlaces(AMOUNT_SCALE);
    const newTargetRate = targetRate.plus(drawAmount).toDecimalPlaces(AMOUNT_SCALE);
    const newSourceAmount = lineAmount('1', newSourceRate, true)!;
    const newTargetAmount = lineAmount('1', newTargetRate, true)!;

    // L-5 — ASSERT the reallocation is net-zero to the in-contract total before trusting the seam.
    // Both leaves count in-contract (CONTINGENCY and IN_CONTRACT/ABSORBED all contribute), so the
    // signed delta is `(newTarget − oldTarget) + (newSource − oldSource)` and MUST be exactly zero.
    const sourceDelta = this.inContractContribution(source, formatAmount(newSourceAmount)).minus(
      this.inContractContribution(source, formatAmount(sourceAmount)),
    );
    const targetDelta = this.inContractContribution(
      target,
      formatAmount(newTargetAmount),
    ).minus(this.inContractContribution(target, formatAmount(toDecimal(target.totalAmount))));
    const netDelta = sourceDelta.plus(targetDelta);
    if (!netDelta.isZero()) {
      // Defensive: with quantity = 1 on both sides this can never fire, but the pin is only as safe
      // as this check — never trust `allowContractValueChange` blindly.
      throw new ConflictException({
        message: 'A contingency draw must not change the contract value.',
        errorCode: 'CONTRACT_VALUE_LOCKED',
        details: { netDelta: formatAmount(netDelta) },
      });
    }
    // The seam is reused only for the COMMITTED pin; the assertion above is the real guard. On a
    // pre-commit DRAFT the pin is a no-op anyway (status !== COMMITTED).
    this.assertPinAllows(status, toDecimal('0'), toDecimal('0'), true);

    await this.repo.reallocateBetweenNodes(
      prisma,
      { id: source.id, data: { unitRate: newSourceRate, totalAmount: newSourceAmount } },
      { id: target.id, data: { unitRate: newTargetRate, totalAmount: newTargetAmount } },
      {
        ...this.changeBase(identity, boq, versionId),
        nodeId: target.id,
        code: target.code,
        action: 'MOVE',
        field: 'totalAmount',
        oldValue: formatAmount(toDecimal(target.totalAmount)),
        newValue: formatAmount(newTargetAmount),
        detail: `Drew ${formatAmount(drawAmount)} from contingency ${source.code} to ${target.code}`,
      },
    );

    // Re-read so the returned figures reflect the committed rows (C-2 derived remaining).
    const after = await this.repo.findNodesByVersion(prisma, versionId);
    return {
      contingencyRemaining: formatAmount(
        sumAmounts(
          after.filter((node) => isContingencyLeaf(node)).map((node) => toDecimal(node.totalAmount)),
        ),
      ),
      inContractTotal: formatAmount(
        sumAmounts(
          after
            .filter((node) => contributesToInContractTotal(node))
            .map((node) => toDecimal(node.totalAmount)),
        ),
      ),
    };
  }

  /**
   * Add a SEPARATE_CHARGE line in place — ADR-029 CONST-BOQ-033 / spec E-3.
   *
   * A separate charge is a real BOQ node (cost-coded, progress-tracked) that is EXCLUDED from the
   * in-contract total (contributesToInContractTotal is false for SEPARATE_CHARGE). Adding it is
   * therefore inherently pin-neutral on a COMMITTED version — its prospective delta is 0 — so no
   * `allowContractValueChange` is needed; the pin passes because the total does not move. This is a
   * thin wrapper over `addNode` with the server-only `commercialTreatment` seam set, so it reuses the
   * full add path (code auto-numbering, node validation, dense positioning, the CREATE change event).
   *
   * The one-off Commercial billing object for a separate charge (a ClientInvoice with a null
   * sourceInstallmentId feeding totalClientRevenue — spec R-4/R-7) is NOT built here. It is R7.
   * TODO(R7): raise the separate-charge billing line in Commercial when this node is added.
   */
  async addSeparateChargeLine(
    identity: RequestIdentity,
    projectId: string,
    versionId: string,
    dto: CreateNodeDto,
  ): Promise<BoqNode> {
    return this.addNode(identity, projectId, versionId, dto, {
      commercialTreatment: 'SEPARATE_CHARGE',
    });
  }

  /**
   * Add an ABSORBED leaf funded net-zero by an equal contingency reduction — ADR-029 CONST-BOQ-030
   * / spec E-1, C-4.
   *
   * ACCO funds this extra itself: no client charge, contract value unchanged. An ABSORBED leaf
   * COUNTS toward the in-contract total (the shared policy), so its +amount must be matched by an
   * equal −amount contingency reduction for the total to stay constant and the L-5 pin to pass. This
   * is the R4 net-zero reallocation shape, except the target is the ABSORBED leaf created in the same
   * transaction rather than an existing line — so the whole thing (create the leaf + draw the funding
   * + both change events) is one atomic write via `addAbsorbedFundedByContingency`.
   *
   * The funded scope is a lump-sum: `amount` lands entirely on the leaf (quantity 1, rate = amount),
   * mirroring the allowance-style shape the contingency draw requires, so no rate/quantity is
   * distorted. The contingency source is decremented by the same amount with quantity kept at 1.
   */
  async addAbsorbedScope(
    identity: RequestIdentity,
    projectId: string,
    versionId: string,
    dto: { parentId?: string; code?: string; description: string; unit?: string; amount: string },
  ): Promise<BoqNode> {
    const prisma = this.tenancyService.getClient();
    const boq = await this.requireBoqForProject(prisma, projectId, identity.activeOrganizationId);
    this.requireVersionBelongsToBoq(versionId, boq);
    const status = await this.requireWritableVersion(prisma, versionId);

    const amount = toDecimal(dto.amount);
    if (amount === null || amount.isNaN() || !amount.greaterThan(0)) {
      throw new BadRequestException('The absorbed scope amount must be a positive number.');
    }

    // Parent (optional) — an ABSORBED leaf may sit under a section like any other item.
    let parentPath: string | null = null;
    let parentDepth = -1;
    let parentIsItem = false;
    let parentCode: string | null = null;
    if (dto.parentId) {
      const parent = await this.repo.findNodeById(prisma, dto.parentId);
      if (!parent || parent.versionId !== versionId) {
        throw new NotFoundException(`Parent node ${dto.parentId} not found in this version`);
      }
      parentPath = parent.path;
      parentDepth = parent.depth;
      parentIsItem = parent.isLeaf;
      parentCode = parent.code;
    }

    // The named allowance to fund from — the same single-source, allowance-shape rule the R4 draw
    // enforces (drawing from a specific pool of several is not yet supported).
    const nodes = await this.repo.findNodesByVersion(prisma, versionId);
    const contingencyLeaves = nodes.filter((node) => isContingencyLeaf(node));
    if (contingencyLeaves.length === 0) {
      throw new BadRequestException('This BOQ has no contingency allowance to absorb scope against.');
    }
    if (contingencyLeaves.length > 1) {
      throw new BadRequestException(
        'This BOQ has more than one contingency line; absorbing against a specific pool is not yet supported.',
      );
    }
    const source = contingencyLeaves[0]!;
    const one = toDecimal('1')!;
    const sourceQty = toDecimal(source.quantity);
    if (sourceQty === null || !sourceQty.equals(one)) {
      throw new BadRequestException(
        'The contingency line must be an allowance (quantity 1) to fund absorbed scope.',
      );
    }
    const sourceAmount = toDecimal(source.totalAmount) ?? toDecimal('0')!;
    if (amount.greaterThan(sourceAmount)) {
      throw new BadRequestException({
        message: 'The absorbed scope exceeds the contingency remaining on this line.',
        errorCode: 'CONTINGENCY_EXCEEDED',
        details: { requested: formatAmount(amount), remaining: formatAmount(sourceAmount) },
      });
    }

    // The ABSORBED leaf is a lump-sum: quantity 1, rate = amount, so totalAmount == amount with no
    // distortion (the same allowance shape the funding draw uses).
    const addedTotal = lineAmount('1', amount, true)!;
    // L-5 — ASSERT net-zero before trusting the pin seam: +addedTotal (ABSORBED counts) and
    // −amount off the contingency leaf (which also counts) must sum to zero.
    const newSourceRate = (toDecimal(source.unitRate) ?? toDecimal('0')!)
      .minus(amount)
      .toDecimalPlaces(AMOUNT_SCALE);
    const newSourceAmount = lineAmount('1', newSourceRate, true)!;
    const addedContribution = this.inContractContribution(
      { isLeaf: true, commercialTreatment: 'ABSORBED' },
      formatAmount(addedTotal),
    );
    const sourceDelta = this.inContractContribution(source, formatAmount(newSourceAmount)).minus(
      this.inContractContribution(source, formatAmount(sourceAmount)),
    );
    const netDelta = addedContribution.plus(sourceDelta);
    if (!netDelta.isZero()) {
      throw new ConflictException({
        message: 'Absorbing scope must not change the contract value.',
        errorCode: 'CONTRACT_VALUE_LOCKED',
        details: { netDelta: formatAmount(netDelta) },
      });
    }
    // The seam is reused only for the COMMITTED pin; the assertion above is the real guard.
    this.assertPinAllows(status, toDecimal('0'), toDecimal('0'), true);

    const overrideCode = dto.code?.trim();
    const targetOrder = await this.repo.countSiblings(prisma, versionId, dto.parentId ?? null);

    for (let attempt = 1; ; attempt += 1) {
      const code =
        overrideCode && overrideCode.length > 0
          ? overrideCode
          : proposeNodeCode(
              'item',
              parentCode,
              await this.repo.findChildCodes(prisma, versionId, dto.parentId ?? null),
            );

      this.assertValid(
        validateNodeWrite(
          {
            code,
            isLeaf: true,
            unit: dto.unit,
            quantity: '1',
            unitRate: amount.toString(),
            currency: undefined,
            depth: parentDepth + 1,
          },
          {
            boqCurrency: boq.currency,
            siblingCodes: await this.repo.findCodesInVersion(prisma, versionId),
            parentIsItem,
            hasChildren: false,
          },
        ),
      );

      try {
        return await this.repo.addAbsorbedFundedByContingency(
          prisma,
          {
            data: {
              boqId: boq.id,
              versionId,
              parentId: dto.parentId ?? null,
              path: '',
              depth: parentDepth + 1,
              sortOrder: targetOrder,
              code,
              description: dto.description,
              isLeaf: true,
              measurementMethod: MeasurementMethod.QUANTITY,
              pricingBasis: PricingBasis.LUMP_SUM,
              unit: dto.unit ?? null,
              quantity: '1',
              unitRate: amount.toString(),
              currency: boq.currency,
              totalAmount: formatAmount(addedTotal),
              nodeRole: 'WORK',
              commercialTreatment: 'ABSORBED',
            },
            parentPath,
            targetOrder,
          },
          {
            id: source.id,
            data: { unitRate: newSourceRate, totalAmount: newSourceAmount },
          },
          {
            ...this.changeBase(identity, boq, versionId),
            code,
            action: 'CREATE',
            detail: `Absorbed scope ${code} funded from contingency ${source.code}`,
          },
          {
            ...this.changeBase(identity, boq, versionId),
            nodeId: source.id,
            code: source.code,
            action: 'MOVE',
            field: 'totalAmount',
            oldValue: formatAmount(sourceAmount),
            newValue: formatAmount(newSourceAmount),
            detail: `Drew ${formatAmount(amount)} from contingency ${source.code} to absorb ${code}`,
          },
        );
      } catch (error) {
        if (!overrideCode && attempt < 4 && isDuplicateCodeConflict(error)) continue;
        throw error;
      }
    }
  }

  /**
   * The version's change log, newest first — the "who changed what, and what was it before" feed
   * (BOQ refinement Phase 1). Resolves actor names in one batch query.
   */
  async getHistory(
    identity: RequestIdentity,
    projectId: string,
    versionId: string,
    options: { nodeId?: string; take: number; skip: number },
  ): Promise<BoqChangeEventResponse[]> {
    const prisma = this.tenancyService.getClient();
    const boq = await this.requireBoqForProject(prisma, projectId, identity.activeOrganizationId);
    this.requireVersionBelongsToBoq(versionId, boq);

    const events = await this.repo.findHistory(prisma, versionId, options);
    const names = await this.repo.findActorNames(prisma, [
      ...new Set(events.map((event) => event.actorUserId)),
    ]);

    return events.map((event) => ({
      id: event.id,
      versionId: event.versionId,
      nodeId: event.nodeId,
      code: event.code,
      action: event.action,
      field: event.field,
      oldValue: event.oldValue,
      newValue: event.newValue,
      detail: event.detail,
      actorUserId: event.actorUserId,
      actorName: names.get(event.actorUserId) ?? null,
      createdAt: event.createdAt.toISOString(),
    }));
  }

  // ─── Private helpers ──────────────────────────────────────────────────────────

  /** The org/boq/version/actor fields every change event shares. */
  private changeBase(
    identity: RequestIdentity,
    boq: BoqWithVersions,
    versionId: string,
  ): Pick<BoqChangeEventInput, 'organizationId' | 'boqId' | 'versionId' | 'actorUserId'> {
    return {
      organizationId: identity.activeOrganizationId,
      boqId: boq.id,
      versionId,
      actorUserId: identity.userId,
    };
  }

  private moveEvent(
    identity: RequestIdentity,
    boq: BoqWithVersions,
    versionId: string,
    node: BoqNode,
  ): BoqChangeEventInput {
    return {
      ...this.changeBase(identity, boq, versionId),
      nodeId: node.id,
      code: node.code,
      action: 'MOVE',
      detail: `Moved ${node.code}`,
    };
  }

  /**
   * One UPDATE event per field that actually changed, with its before/after — this is what makes
   * the log read "rate 80.00 → 85.00". Quantities and rates are compared as decimals so a
   * reformat ("85" vs "85.00") is not mistaken for an edit.
   */
  private buildUpdateEvents(
    identity: RequestIdentity,
    boq: BoqWithVersions,
    node: BoqNode,
    dto: UpdateNodeDto,
    resolved: { code: string; isLeaf: boolean; unit: string | null; quantity: string | null; unitRate: string | null },
  ): BoqChangeEventInput[] {
    const base = {
      ...this.changeBase(identity, boq, node.versionId),
      nodeId: node.id,
      code: resolved.code,
      action: 'UPDATE' as const,
    };
    const events: BoqChangeEventInput[] = [];

    const textChanged = (field: string, before: string | null, after: string | null | undefined) => {
      if (after === undefined) return; // field not part of this patch
      const from = before ?? null;
      const to = after ?? null;
      if (from !== to) events.push({ ...base, field, oldValue: from, newValue: to });
    };
    const numberChanged = (field: string, before: BoqNode['quantity'], after: string | null) => {
      const from = before !== null ? toDecimal(before) : null;
      const to = after !== null ? toDecimal(after) : null;
      const differs = from === null || to === null ? from !== to : !from.equals(to);
      if (differs) {
        events.push({ ...base, field, oldValue: before !== null ? before.toString() : null, newValue: after });
      }
    };

    textChanged('code', node.code, resolved.code);
    textChanged('description', node.description, dto.description);
    if (resolved.isLeaf) {
      textChanged('unit', node.unit, resolved.unit);
      numberChanged('quantity', node.quantity, resolved.quantity);
      numberChanged('unitRate', node.unitRate, resolved.unitRate);
    }
    textChanged('measurementMethod', node.measurementMethod, dto.measurementMethod);
    textChanged('pricingBasis', node.pricingBasis, dto.pricingBasis);

    return events;
  }

  private assertValid(violations: { code: string; message: string }[]): void {
    if (violations.length === 0) return;
    throw new BadRequestException({
      message: violations[0]!.message,
      details: { violations },
    });
  }

  /** Levels below `node`, 0 when it is a leaf of the tree. */
  private async subtreeHeight(
    prisma: ReturnType<TenancyService['getClient']>,
    versionId: string,
    node: BoqNode,
  ): Promise<number> {
    const nodes = await this.repo.findNodesByVersion(prisma, versionId);
    const prefix = `${node.path}/`;
    return nodes
      .filter((candidate) => candidate.path.startsWith(prefix))
      .reduce((max, descendant) => Math.max(max, descendant.depth - node.depth), 0);
  }

  private async requireBoqForProject(
    prisma: ReturnType<TenancyService['getClient']>,
    projectId: string,
    organizationId: string,
  ): Promise<BoqWithVersions> {
    const boq = await this.repo.findByProject(prisma, projectId);
    if (!boq) throw new NotFoundException(`No BOQ found for project ${projectId}`);
    if (boq.organizationId !== organizationId) throw new ForbiddenException();
    return boq;
  }

  private requireVersionBelongsToBoq(versionId: string, boq: BoqWithVersions): void {
    const belongs = boq.versions.some((v) => v.id === versionId);
    if (!belongs) throw new NotFoundException(`Version ${versionId} does not belong to this BOQ`);
  }

  /**
   * The write guard — ADR-029 §2 L-6.
   *
   * A node write is legal in-place on the one operational version, whether it is still a
   * pre-commit `DRAFT` or a live `COMMITTED` one; the operational version's ids are stable
   * (L-6) and its edits are immediately real downstream, which is the whole point of the
   * in-place model. A `SNAPSHOT` is a frozen legal record (403 — L-4). `SUPERSEDED` /
   * `CANCELLED` are dead pre-commit drafts and never editable.
   *
   * Returns the version's status so the caller can apply the post-commit value pin (L-5) only
   * when it is `COMMITTED`.
   */
  private async requireWritableVersion(
    prisma: ReturnType<TenancyService['getClient']>,
    versionId: string,
  ): Promise<'DRAFT' | 'COMMITTED'> {
    const version = await this.repo.findVersion(prisma, versionId);
    if (!version) throw new NotFoundException(`Version ${versionId} not found`);
    if (version.status === 'DRAFT' || version.status === 'COMMITTED') return version.status;
    if (version.status === 'SNAPSHOT') {
      throw new ForbiddenException('A committed snapshot is an immutable record and cannot be edited.');
    }
    throw new ForbiddenException('BOQ nodes can only be modified on the operational version.');
  }

  /**
   * The post-commit contract-value pin — ADR-029 §2 L-5.
   *
   * On a `COMMITTED` version, a write that would change the in-contract billable total is
   * refused (409, `CONTRACT_VALUE_LOCKED`); only the variation command (R6) may raise it, and
   * it passes `allowContractValueChange`. Money-neutral writes — descriptions, codes, reorders,
   * and reallocations that keep the total constant — are unaffected (their prospective delta is
   * zero). The delta is judged *before* the write from the leaf's own IN_CONTRACT contribution,
   * so a rejected write never touches the database.
   */
  private assertPinAllows(
    status: 'DRAFT' | 'COMMITTED',
    before: Decimal | null,
    after: Decimal | null,
    allowContractValueChange: boolean,
  ): void {
    if (status !== 'COMMITTED' || allowContractValueChange) return;
    const changed = before === null || after === null ? before !== after : !before.equals(after);
    if (!changed) return;
    throw new ConflictException({
      message:
        'This BOQ is committed; changing the contract value requires an approved variation.',
      errorCode: 'CONTRACT_VALUE_LOCKED',
      details: {
        before: formatAmount(before),
        after: formatAmount(after),
      },
    });
  }

  /** A leaf's signed contribution to the in-contract total; zero for anything that does not count. */
  private inContractContribution(
    node: Pick<BoqNode, 'isLeaf' | 'commercialTreatment'>,
    amount: DecimalString | null,
  ): Decimal {
    const zero = toDecimal('0')!;
    if (!contributesToInContractTotal(node)) return zero;
    return toDecimal(amount) ?? zero;
  }

  private async requireNode(
    prisma: ReturnType<TenancyService['getClient']>,
    nodeId: string,
    versionId: string,
  ): Promise<BoqNode> {
    const node = await this.repo.findNodeById(prisma, nodeId);
    if (!node || node.versionId !== versionId) {
      throw new NotFoundException(`Node ${nodeId} not found in version ${versionId}`);
    }
    return node;
  }
}

/**
 * True when a write hit the version's unique-code index — the signal to retry an auto-generated
 * code a concurrent add claimed first. An overridden code that collides is not retried.
 */
function isDuplicateCodeConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    String((error.meta as { target?: unknown } | undefined)?.target ?? '').includes('code')
  );
}

/**
 * Flat ordered rows → recursive tree, with section totals summed bottom-up in Decimal.
 *
 * Exported because the readiness, workspace and compare queries all need the same shape and
 * must agree with what the tree endpoint returns.
 */
export function buildTree(nodes: BoqNode[], boqCurrency: string): BoqTreeNodeView[] {
  const views = new Map<string, BoqTreeNodeView>();

  for (const node of nodes) {
    views.set(node.id, {
      id: node.id,
      boqId: node.boqId,
      versionId: node.versionId,
      parentId: node.parentId,
      path: node.path,
      depth: node.depth,
      sortOrder: node.sortOrder,
      code: node.code,
      description: node.description,
      isLeaf: node.isLeaf,
      measurementMethod: node.measurementMethod,
      pricingBasis: node.pricingBasis,
      unit: node.unit,
      quantity: formatQuantity(toDecimal(node.quantity)),
      unitRate: formatAmount(toDecimal(node.unitRate)),
      currency: node.currency ?? boqCurrency,
      totalAmount: formatAmount(toDecimal(node.totalAmount)),
      originNodeId: node.originNodeId,
      sourceType: node.sourceType,
      sourceChangeOrderId: node.sourceChangeOrderId,
      nodeRole: node.nodeRole,
      commercialTreatment: node.commercialTreatment,
      isActive: node.isActive,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      children: [],
      computedTotal: formatAmount(toDecimal(node.totalAmount)),
    });
  }

  const roots: BoqTreeNodeView[] = [];
  for (const view of views.values()) {
    const parent = view.parentId ? views.get(view.parentId) : undefined;
    if (parent) parent.children.push(view);
    else roots.push(view);
  }

  for (const view of views.values()) {
    view.children.sort((a, b) => a.sortOrder - b.sortOrder);
  }
  roots.sort((a, b) => a.sortOrder - b.sortOrder);

  sumSectionTotals(roots);
  return roots;
}

function sumSectionTotals(nodes: BoqTreeNodeView[]): void {
  for (const node of nodes) {
    if (node.children.length === 0) continue;
    sumSectionTotals(node.children);
    node.computedTotal = formatAmount(
      sumAmounts(node.children.map((child) => toDecimal(child.computedTotal))),
    );
  }
}

/** The version's grand total — the sum of its root sections. */
export function treeTotal(roots: BoqTreeNodeView[]): DecimalString | null {
  return formatAmount(sumAmounts(roots.map((root) => toDecimal(root.computedTotal))));
}
