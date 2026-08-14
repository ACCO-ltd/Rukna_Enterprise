import type { BoqTreeNodeResponse as BoqTreeNode } from '@erp/types';

/**
 * A BOQ line that can be claimed on a payment application.
 *
 * Flattened out of the tree with its ancestry kept as a readable path, because a leaf's
 * own code (`01.02`) means little on its own — the surveyor is looking for
 * "Substructure Works › Reinforced concrete foundations".
 */
export interface ClaimableLine {
  id: string;
  code: string;
  description: string;
  /** Ancestor descriptions, outermost first. Empty for a root-level leaf. */
  path: string[];
  unit: string | null;
  /** Decimal string. The contracted quantity, for reference while claiming against it. */
  quantity: string | null;
  /** Decimal string. Sent as `unitRateSnapshot` — see the note in `ipa-api.ts` (C3). */
  unitRate: string | null;
  currency: string | null;
}

/**
 * Flattens a BOQ tree into the lines that may be claimed.
 *
 * Only leaves are claimable — `apps/web/CLAUDE.md:208` requires the item picker to filter
 * by `isLeaf`, and a summary node carries no rate to claim against. Sections are walked
 * for their children and their descriptions kept as the path.
 *
 * A leaf with no `unitRate` is still returned rather than dropped. The API requires a
 * `unitRateSnapshot`, so such a line cannot be claimed — the picker shows it as
 * unavailable, which is more useful than the line silently vanishing from a BOQ the
 * surveyor is reading from.
 */
export function claimableLines(tree: BoqTreeNode[]): ClaimableLine[] {
  const out: ClaimableLine[] = [];

  const walk = (nodes: BoqTreeNode[], path: string[]): void => {
    for (const node of nodes) {
      if (node.isLeaf) {
        out.push({
          id: node.id,
          code: node.code,
          description: node.description,
          path,
          unit: node.unit,
          quantity: node.quantity,
          unitRate: node.unitRate,
          currency: node.currency,
        });
        continue;
      }
      walk(node.children, [...path, node.description]);
    }
  };

  walk(tree, []);
  return out;
}

/** True when a line carries everything the API needs to accept a claim against it. */
export function isClaimable(line: ClaimableLine): boolean {
  return line.unitRate !== null && line.currency !== null;
}

/**
 * Removes lines already claimed on this application.
 *
 * `InterimPaymentApplicationItem` has a unique index on `(applicationId, boqNodeId)`, so a
 * second claim against the same node is a 409. Filtering here turns that into a shorter
 * list rather than an error the user has to interpret.
 */
export function unclaimedLines(
  lines: ClaimableLine[],
  claimedNodeIds: readonly string[],
): ClaimableLine[] {
  const claimed = new Set(claimedNodeIds);
  return lines.filter((line) => !claimed.has(line.id));
}

/** "Substructure Works › Reinforced concrete foundations" for display in a flat list. */
export function lineLabel(line: ClaimableLine): string {
  return [...line.path, `${line.code} ${line.description}`].join(' › ');
}
