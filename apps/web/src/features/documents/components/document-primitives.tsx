'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Badge, cn, type BadgeTone } from '@erp/ui';
import type {
  DocumentRevisionStatus,
  DocumentValidity,
  ProjectDocumentResponse,
  ProjectDocumentStatus,
} from '@erp/types';

import { formatDate } from '@/lib/format';

/**
 * The register's shared vocabulary.
 *
 * One rule runs through all of it: **status, revision and validity are three different facts and
 * are never merged into one chip.** A permit can be ISSUED, at R01, and EXPIRED at the same time,
 * and a reader who sees a single green badge learns none of that. The table gives each its own
 * column and this file gives each its own component.
 *
 * Colour is used only where a state genuinely demands attention. Six differently-coloured chips in
 * a row is not information design, it is decoration that trains people to ignore colour — so
 * Issued and Valid are quiet, and Expired is not.
 */

const DOCUMENT_STATUS_TONE: Record<`${ProjectDocumentStatus}`, BadgeTone> = {
  DRAFT: 'neutral',
  // `live` in the shared vocabulary means "in force right now", which is exactly what an issued
  // document is — the same tone ACTIVE contracts and CERTIFIED IPCs already carry.
  ISSUED: 'live',
  SUPERSEDED: 'historical',
  WITHDRAWN: 'warning',
  ARCHIVED: 'neutral',
};

export function DocumentStatusChip({ status }: { status: `${ProjectDocumentStatus}` }) {
  const t = useTranslations('documents.status');
  return <Badge tone={DOCUMENT_STATUS_TONE[status]}>{t(status)}</Badge>;
}

const REVISION_STATUS_TONE: Record<`${DocumentRevisionStatus}`, BadgeTone> = {
  DRAFT: 'neutral',
  ISSUED: 'live',
  SUPERSEDED: 'historical',
  WITHDRAWN: 'warning',
};

export function RevisionStatusChip({ status }: { status: `${DocumentRevisionStatus}` }) {
  const t = useTranslations('documents.revisionStatus');
  return <Badge tone={REVISION_STATUS_TONE[status]}>{t(status)}</Badge>;
}

/**
 * Validity is quiet when there is nothing to do about it.
 *
 * VALID and NO_EXPIRY are the unremarkable majority of any register, and colouring them would put
 * a second bright chip on every healthy row — which trains a reader to stop seeing the one row
 * that is actually expired. Colour starts at NOT_YET_VALID and escalates from there.
 */
const VALIDITY_TONE: Record<`${DocumentValidity}`, BadgeTone> = {
  NO_EXPIRY: 'neutral',
  VALID: 'neutral',
  NOT_YET_VALID: 'accent',
  EXPIRING_SOON: 'warning',
  EXPIRED: 'danger',
};

/**
 * Validity, with the day count that makes it actionable.
 *
 * "Expiring soon" alone tells someone to look it up; "Expiring soon · in 12 days" tells them
 * whether to act today. The count comes from the server with the state, so the two can never
 * disagree about which side of the threshold a document is on.
 */
export function ValidityChip({
  validity,
  daysUntilExpiry,
}: {
  validity: `${DocumentValidity}`;
  daysUntilExpiry: number | null;
}) {
  const t = useTranslations('documents.validity');

  const detail = (() => {
    if (daysUntilExpiry === null) return null;
    if (validity === 'EXPIRED') return t('expiredAgo', { days: Math.abs(daysUntilExpiry) });
    if (validity === 'EXPIRING_SOON') {
      return daysUntilExpiry === 0 ? t('expiresToday') : t('expiresIn', { days: daysUntilExpiry });
    }
    return null;
  })();

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge tone={VALIDITY_TONE[validity]}>{t(validity)}</Badge>
      {detail ? <span className="text-body-sm text-muted-foreground">{detail}</span> : null}
    </span>
  );
}

/**
 * The revision cell: the code someone would quote, with the number behind it.
 *
 * `revisionCode` is optional by design — not every document class runs a drawing office's
 * numbering — so this falls back to the internal number rather than rendering an em dash and
 * losing the fact that a revision exists at all.
 */
export function RevisionLabel({
  revisionCode,
  revisionNumber,
}: {
  revisionCode: string | null;
  revisionNumber: number;
}) {
  return (
    <span className="tabular-nums font-medium text-foreground">
      {revisionCode ?? `R${String(revisionNumber - 1).padStart(2, '0')}`}
    </span>
  );
}

/**
 * The document identity cell: number above, title below.
 *
 * The number leads because that is what a person arrives holding — off a print, out of an email,
 * from the consultant on the phone. The title is what confirms they have the right one.
 */
export function DocumentIdentity({
  document,
  className,
}: {
  document: Pick<ProjectDocumentResponse, 'documentNumber' | 'title'>;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="truncate font-mono text-body-sm font-semibold text-foreground">
        {document.documentNumber}
      </div>
      <div className="truncate text-body-sm text-muted-foreground" title={document.title}>
        {document.title}
      </div>
    </div>
  );
}

/** A date, or an explicit em dash. Never a fabricated "today". */
export function DateCell({ value }: { value: string | null }) {
  const locale = useLocale() as 'en' | 'ar';
  if (!value) return <span className="text-muted-foreground">—</span>;
  return <span className="tabular-nums">{formatDate(value, locale) ?? '—'}</span>;
}

/** A person, or an explicit absence — an unassigned document is a real and visible fact. */
export function PersonCell({ name }: { name: string | null }) {
  const t = useTranslations('documents.detail');
  if (!name) return <span className="text-muted-foreground">{t('notSet')}</span>;
  return <span className="truncate">{name}</span>;
}

/** Human-readable file size. Display only — never a financial figure. */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
