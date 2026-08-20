import type { PrismaClient } from '@prisma/client';
import type { Decimal } from '@prisma/client/runtime/library';
import type {
  JournalCategory,
  EntryPurpose,
  PostingOrigin,
  SourceDocType,
  SubledgerType,
} from '@prisma/client';

export const ACCOUNTING_POSTING_PORT = Symbol('IAccountingPostingPort');

export type TxClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export interface PostingLineCommand {
  accountId: string;
  debitAmount?: Decimal;
  creditAmount?: Decimal;
  sourceSubledgerType?: SubledgerType;
  /** "PROFILE_CODE@vN" — immutable snapshot of posting profile resolution. */
  resolutionSource?: string;
  postingProfileVersionId?: string;
  projectId?: string;
  departmentId?: string;
  costCenterId?: string;
  clientId?: string;
  supplierId?: string;
  contractId?: string;
  boqNodeId?: string;
  taxCodeId?: string;
  memo?: string;
}

export interface PostingCommand {
  organizationId: string;
  /** Determines which accounting period receives this entry. */
  accountingDate: Date;
  /** Document date — may differ from accountingDate (e.g. invoice date). */
  documentDate: Date;
  description: string;
  /** ISO-4217 currency code (always 'USD' — ACCO is single-currency, ADR-024). */
  currencyCode: string;
  /** Accounting event identifier for idempotency (e.g. 'EVT-AR-001'). */
  eventType: string;
  sourceDocumentType: SourceDocType;
  sourceDocumentId: string;
  journalCategory: JournalCategory;
  entryPurpose: EntryPurpose;
  postingOrigin: PostingOrigin;
  reversalOfJournalEntryId?: string;
  createdBy: string;
  /** Provided for manual journals that went through CFO approval workflow. */
  approvedBy?: string;
  lines: PostingLineCommand[];
}

export interface PostingResult {
  journalEntryId: string;
  journalNumber: string;
}

export interface IAccountingPostingPort {
  post(command: PostingCommand, tx: TxClient): Promise<PostingResult>;
}
