/**
 * Project activity history — naming what an event was done to (the pure half).
 *
 * An activity row carries a type and an id (`Contract`, `cm…`); a reader needs the record's
 * business reference ("ACC-HDN-26-0005-C1") and, where one exists, the page that shows it. This
 * module decides, per row, which record names the event (`targetRefOf`), and turns the loaded
 * records into `{ label, href }` (`buildActivityTarget`). The repository loads each kind of
 * record in one query for the whole page (`findActivityTargetRecords`), so a page of events costs
 * a fixed number of lookups however many rows it has.
 *
 * A label is a reference — a number, a code, a name — never an amount. Rows reach this module
 * only after the family filter (`readableActivityFamilies`), so the reader may already see every
 * record named here. A row whose record is gone, whose type names no single record (a
 * request-logged BOQ or team change, keyed by the project id), or whose record has no reference,
 * gets `null`.
 */

export interface ActivityTarget {
  label: string;
  href?: string;
}

/** The kinds of record an activity row can be named by. */
export type ActivityTargetKind =
  | 'contract'
  | 'installment'
  | 'advanceTerm'
  | 'deliverable'
  | 'guarantee'
  | 'variation'
  | 'document'
  | 'revision'
  | 'baseline'
  | 'invoice'
  | 'receipt';

export interface ActivityTargetRef {
  kind: ActivityTargetKind;
  id: string;
}

/** Outbox resource types whose `resourceId` is the record that names the event. */
const RESOURCE_KIND: Readonly<Record<string, ActivityTargetKind>> = {
  Contract: 'contract',
  // Keyed by the contract id (see ACTIVITY_OUTBOX_RESOURCES).
  ContractPaymentPlan: 'contract',
  ContractRetentionTerms: 'contract',
  ContractPaymentInstallment: 'installment',
  ContractAdvanceTerm: 'advanceTerm',
  ContractDeliverable: 'deliverable',
  ContractMilestone: 'deliverable',
  ContractGuarantee: 'guarantee',
  VariationOrder: 'variation',
  ProjectDocument: 'document',
  ProjectDocumentRevision: 'revision',
  ProgrammeBaseline: 'baseline',
};

/** Invoice-issuing commercial commands record the invoice ids in `after`; name the invoice. */
const INVOICE_COMMANDS = new Set(['commercial.issuePackage', 'commercial.issueInvoice']);

/**
 * Preparing a stage's bill creates draft invoices, which have no number yet — so it is named by
 * the payment stage (`after.installmentId` on the contract row; the installment row is the stage).
 */
const PREPARE_COMMAND = 'commercial.preparePackage';

const RECEIPT_COMMAND = 'commercial.recordProjectPayment';

function stringField(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'string' && field.length > 0 ? field : null;
}

function firstInvoiceId(after: unknown): string | null {
  const single = stringField(after, 'milestoneInvoiceId');
  if (single) return single;
  if (!after || typeof after !== 'object' || Array.isArray(after)) return null;
  const ids = (after as Record<string, unknown>)['invoiceIds'];
  return Array.isArray(ids) && typeof ids[0] === 'string' && ids[0].length > 0 ? ids[0] : null;
}

/**
 * The record that names a row, or null. Only outbox rows (`sourceCommand` set) are named: their
 * `resourceId` is the record itself. A request-logged row's id is the project, which says nothing
 * about which version, member or report it touched.
 */
export function targetRefOf(row: {
  resource: string;
  resourceId: string;
  sourceCommand: string | null;
  after?: unknown;
}): ActivityTargetRef | null {
  if (!row.sourceCommand) return null;
  if (row.sourceCommand === PREPARE_COMMAND) {
    const installmentId =
      stringField(row.after, 'installmentId') ??
      (row.resource === 'ContractPaymentInstallment' ? row.resourceId : null);
    return installmentId ? { kind: 'installment', id: installmentId } : null;
  }
  if (INVOICE_COMMANDS.has(row.sourceCommand)) {
    const invoiceId = firstInvoiceId(row.after);
    if (invoiceId) return { kind: 'invoice', id: invoiceId };
  }
  if (row.sourceCommand === RECEIPT_COMMAND) {
    const receiptId = stringField(row.after, 'receiptId');
    return receiptId ? { kind: 'receipt', id: receiptId } : null;
  }
  const kind = RESOURCE_KIND[row.resource];
  return kind ? { kind, id: row.resourceId } : null;
}

/** The ids of each kind a page of rows needs, deduplicated. */
export function groupTargetRefs(refs: readonly (ActivityTargetRef | null)[]): Map<ActivityTargetKind, string[]> {
  const grouped = new Map<ActivityTargetKind, Set<string>>();
  for (const ref of refs) {
    if (!ref) continue;
    const ids = grouped.get(ref.kind) ?? new Set<string>();
    ids.add(ref.id);
    grouped.set(ref.kind, ids);
  }
  return new Map([...grouped].map(([kind, ids]) => [kind, [...ids]]));
}

/**
 * What the repository loaded for one kind: the reference and, for records shown on a page of
 * their own, the ids that page's route needs. `reference` null = the record has no reference to
 * show (an advance term without a description, a guarantee without a reference number).
 */
export interface ActivityTargetRecord {
  reference: string | null;
  /** Project-document id, for a revision's document page. */
  documentId?: string;
}

export type ActivityTargetRecords = Map<ActivityTargetKind, Map<string, ActivityTargetRecord>>;

/** Free-text references (an advance term's description) are cut to one readable line. */
const MAX_LABEL = 80;

function clip(label: string): string {
  const flat = label.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_LABEL ? `${flat.slice(0, MAX_LABEL - 1)}…` : flat;
}

/** The app route that shows a record of this kind, when it has a stable one. */
function hrefOf(projectId: string, ref: ActivityTargetRef, record: ActivityTargetRecord): string | undefined {
  const project = `/projects/${projectId}`;
  switch (ref.kind) {
    // The contract, its schedule, deliverables, guarantees and changes all live on Contract.
    case 'contract':
    case 'installment':
    case 'advanceTerm':
    case 'deliverable':
    case 'guarantee':
    case 'variation':
      return `${project}/commercial/contract`;
    case 'invoice':
      return `${project}/commercial/invoices/${ref.id}`;
    case 'document':
      return `${project}/documents/${ref.id}`;
    case 'revision':
      return record.documentId ? `${project}/documents/${record.documentId}` : undefined;
    // A programme baseline and a receipt have no page a project member can be sent to.
    case 'baseline':
    case 'receipt':
      return undefined;
  }
}

export function buildActivityTarget(
  projectId: string,
  ref: ActivityTargetRef | null,
  records: ActivityTargetRecords,
): ActivityTarget | null {
  if (!ref) return null;
  const record = records.get(ref.kind)?.get(ref.id);
  if (!record || !record.reference) return null;
  const label = clip(record.reference);
  if (!label) return null;
  const href = hrefOf(projectId, ref, record);
  return href ? { label, href } : { label };
}
