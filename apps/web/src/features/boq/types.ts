import { BoqVersionStatus } from '@erp/types';

/**
 * BOQ wire shapes. Declared locally for the same reason as the Project types — `@erp/types`
 * exports the enums but no DTOs, and `packages/types` is backend-owned (B12).
 *
 * Decimal columns serialize as STRINGS (`quantity` at 3dp, `unitRate` and `totalAmount` at
 * 2dp). `computedTotal` is the exception: the API computes it at query time and sends a
 * JS number. Neither is ever used for arithmetic here — see src/lib/format.ts.
 */
export interface BoqVersion {
  id: string;
  boqId: string;
  versionNumber: number;
  status: BoqVersionStatus;
  notes: string | null;
  baselinedAt: string | null;
  baselinedBy: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Boq {
  id: string;
  projectId: string;
  organizationId: string;
  /** The first-ever baseline. Immutable once set — the original contract BOQ. */
  originalBaselineVersionId: string | null;
  currentApprovedVersionId: string | null;
  currentDraftVersionId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Newest version first, as the API orders them. */
  versions: BoqVersion[];
}

export interface BoqTreeNode {
  id: string;
  boqId: string;
  versionId: string;
  parentId: string | null;
  /** Materialized path of node ids, "rootId/childId/grandchildId". */
  path: string;
  depth: number;
  sortOrder: number;
  code: string;
  description: string;
  descriptionAr: string | null;
  unit: string | null;
  quantity: string | null;
  unitRate: string | null;
  currency: string | null;
  totalAmount: string | null;
  isLeaf: boolean;
  originNodeId: string | null;
  createdAt: string;
  updatedAt: string;
  children: BoqTreeNode[];
  /** Server-computed: own amount for a leaf, sum of descendants for a summary. */
  computedTotal: number | null;
}

export { BoqVersionStatus };
