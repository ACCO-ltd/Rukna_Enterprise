import { StatusPill, StatusText } from '@erp/ui';

import { statusLabel, statusTone, type StatusVocabulary } from '@/lib/status-registry';

interface StatusBadgeProps {
  /** The raw status key from the API, e.g. "PENDING_INTERNAL_APPROVAL". */
  status: string;
  /**
   * Which lifecycle the status belongs to. The same word can carry a different tone on a
   * different record (ACTIVE project vs ACTIVE supplier), so always pass it; omitting it
   * falls back to the registry's generic table.
   */
  vocabulary?: StatusVocabulary;
  /** Translated label. When omitted the status key is humanised. */
  label?: string;
  className?: string;
}

/**
 * A record's primary lifecycle status, toned by the status registry (ADR-034). Every
 * screen renders statuses through this — never through a local status→colour map.
 *
 * @example
 * <StatusBadge vocabulary="journal" status={journal.status} label={t(`status.${journal.status}`)} />
 */
export function StatusBadge({ status, vocabulary, label, className }: StatusBadgeProps) {
  return (
    <StatusPill tone={statusTone(status, vocabulary)} className={className}>
      {label ?? statusLabel(status, vocabulary)}
    </StatusPill>
  );
}

interface SecondaryStatusProps {
  status: string;
  label?: string;
  /** Axis name shown before the value — "Posting: Pending". Omit inside a labelled column. */
  axis?: string;
  className?: string;
}

/**
 * A document's posting status — the second axis, rendered as quiet dot + text so it never
 * competes with the document-status pill beside it.
 */
export function PostingStatus({ status, label, axis, className }: SecondaryStatusProps) {
  return (
    <StatusText tone={statusTone(status, 'posting')} axis={axis} className={className}>
      {label ?? statusLabel(status, 'posting')}
    </StatusText>
  );
}

/** A supplier bill's match status — the third axis; show it only once matching has run. */
export function MatchStatus({ status, label, axis, className }: SecondaryStatusProps) {
  return (
    <StatusText tone={statusTone(status, 'billMatch')} axis={axis} className={className}>
      {label ?? statusLabel(status, 'billMatch')}
    </StatusText>
  );
}
