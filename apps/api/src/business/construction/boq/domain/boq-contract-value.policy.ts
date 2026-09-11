/**
 * In-contract billable total — ADR-029 CONST-BOQ-030 / spec T-1.
 *
 * The single figure a committed BOQ ties out to (it equals the contract value). It is the sum of
 * every *leaf* amount EXCEPT `SEPARATE_CHARGE` — the internal budget pie:
 *
 *  - IN_CONTRACT leaves (original scope + on-contract variations) count in.
 *  - CONTINGENCY-role leaves count in — the named allowance is part of the contract value
 *    (CONST-BOQ-028); it is `nodeRole`, not `commercialTreatment`, that marks contingency, and it
 *    keeps the IN_CONTRACT treatment.
 *  - ABSORBED leaves count in — an absorbed extra is funded by an equal contingency draw
 *    (CONST-BOQ-030 / spec C-4), so counting it keeps the total constant (net-zero). *Excluding*
 *    it would drop the total below the contract value the instant scope is absorbed, breaking the
 *    tie-out.
 *  - SEPARATE_CHARGE leaves are excluded — billed one-off outside the contract; they feed total
 *    client revenue, not the contract value.
 *
 * Pure and synchronous, mirroring `boq-money`/`boq-readiness`: the caller supplies the nodes.
 * This is the exact function R3's contract tie-out (`Contract.baseContractValue`) reuses, so it
 * lives here as the one shared definition — a second implementation would be the crack a
 * mismatched contract value slips through.
 */

import type { BoqNode } from '@prisma/client';

import { sumAmounts, toDecimal, type DecimalString, formatAmount } from './boq-money.js';
import type { Decimal } from '@prisma/client/runtime/library';

/**
 * True when this node contributes to the in-contract total: any leaf except a SEPARATE_CHARGE
 * one. Sections carry no amount; IN_CONTRACT (incl. CONTINGENCY-role) and ABSORBED leaves count;
 * only SEPARATE_CHARGE — billed outside the contract — is out.
 */
export function contributesToInContractTotal(
  node: Pick<BoqNode, 'isLeaf' | 'commercialTreatment'>,
): boolean {
  return node.isLeaf && node.commercialTreatment !== 'SEPARATE_CHARGE';
}

/** Σ leaf.totalAmount over IN_CONTRACT leaves. Null when nothing contributes (never a false `0`). */
export function inContractBillableTotal(
  nodes: Pick<BoqNode, 'isLeaf' | 'commercialTreatment' | 'totalAmount'>[],
): Decimal | null {
  return sumAmounts(
    nodes
      .filter((node) => contributesToInContractTotal(node))
      .map((node) => toDecimal(node.totalAmount)),
  );
}

/** The wire-serialized form of {@link inContractBillableTotal}. */
export function formatInContractBillableTotal(
  nodes: Pick<BoqNode, 'isLeaf' | 'commercialTreatment' | 'totalAmount'>[],
): DecimalString | null {
  return formatAmount(inContractBillableTotal(nodes));
}

/**
 * True when this node is a piece of the named contingency allowance — a CONTINGENCY-role leaf.
 * A section marked CONTINGENCY carries no amount, so it never contributes; the rule is leaf-only,
 * matching how every other total in this module is summed over leaves.
 */
export function isContingencyLeaf(node: Pick<BoqNode, 'isLeaf' | 'nodeRole'>): boolean {
  return node.isLeaf && node.nodeRole === 'CONTINGENCY';
}

/**
 * Contingency remaining — ADR-029 CONST-BOQ-028 / spec C-2.
 *
 * `Σ leaf.totalAmount over nodeRole = CONTINGENCY leaves`. Derived, never stored: under the
 * reallocation model (spec C-3), a draw lowers the contingency leaf's own amount, so the live sum
 * of the allowance lines *is* what is left — there is no separate "draws to date" ledger to net
 * off, and there can never be one to drift from. Null when there is no contingency line at all
 * (never a false `0`, so the workspace can tell "no allowance" from "allowance fully drawn").
 *
 * Same shape and reuse discipline as {@link inContractBillableTotal}: one definition of the figure,
 * pure and synchronous, the caller supplies the nodes.
 */
export function contingencyRemaining(
  nodes: Pick<BoqNode, 'isLeaf' | 'nodeRole' | 'totalAmount'>[],
): Decimal | null {
  return sumAmounts(
    nodes.filter((node) => isContingencyLeaf(node)).map((node) => toDecimal(node.totalAmount)),
  );
}

/** The wire-serialized form of {@link contingencyRemaining}. */
export function formatContingencyRemaining(
  nodes: Pick<BoqNode, 'isLeaf' | 'nodeRole' | 'totalAmount'>[],
): DecimalString | null {
  return formatAmount(contingencyRemaining(nodes));
}

/**
 * True when this node is a separate charge — a SEPARATE_CHARGE-treatment leaf. Sections carry no
 * amount, so the rule is leaf-only, exactly like {@link contributesToInContractTotal} and
 * {@link isContingencyLeaf}. This is the precise complement of the SEPARATE_CHARGE exclusion in
 * {@link contributesToInContractTotal}: a leaf is either in the in-contract total or a separate
 * charge, never both.
 */
export function isSeparateChargeLeaf(
  node: Pick<BoqNode, 'isLeaf' | 'commercialTreatment'>,
): boolean {
  return node.isLeaf && node.commercialTreatment === 'SEPARATE_CHARGE';
}

/**
 * Separate-charge total — ADR-029 CONST-BOQ-030 / CONST-BOQ-033, spec T-5 / R-4.
 *
 * `Σ leaf.totalAmount over commercialTreatment = SEPARATE_CHARGE leaves`. These are the exact leaves
 * {@link inContractBillableTotal} *excludes* (they are billed one-off, outside the contract), so
 * this is its complement over leaves. It is the Σ term in
 * `totalClientRevenue = currentContractValue + Σ separate charges` (CONST-BOQ-030): separate charges
 * feed total client revenue and NEVER the contract value.
 *
 * Same shape and reuse discipline as {@link contingencyRemaining} / {@link inContractBillableTotal}:
 * one definition of the figure, pure and synchronous, the caller supplies the nodes. Null when there
 * is no separate-charge line at all (never a false `0`, so a caller can tell "no separate charges"
 * from "separate charges summing to zero").
 */
export function separateChargeTotal(
  nodes: Pick<BoqNode, 'isLeaf' | 'commercialTreatment' | 'totalAmount'>[],
): Decimal | null {
  return sumAmounts(
    nodes.filter((node) => isSeparateChargeLeaf(node)).map((node) => toDecimal(node.totalAmount)),
  );
}

/** The wire-serialized form of {@link separateChargeTotal}. */
export function formatSeparateChargeTotal(
  nodes: Pick<BoqNode, 'isLeaf' | 'commercialTreatment' | 'totalAmount'>[],
): DecimalString | null {
  return formatAmount(separateChargeTotal(nodes));
}
