'use client';

import { useLocale, useTranslations } from 'next-intl';
import {
  BadgeCheck,
  CircleDollarSign,
  Clock,
  FileText,
  MessageSquare,
  Send,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from '@erp/ui';

import { formatDate, formatMoney } from '@/lib/format';

import type { TimelineEntry, TimelineEventKind } from '../lib/collection-events';
import type { ClientReceivableView } from '../lib/collection-view-model';

// ─── Timeline Dialog ──────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: ClientReceivableView;
  entries: TimelineEntry[];
  currency: string;
}

export function InvoiceTimelineDialog({ open, onOpenChange, invoice, entries, currency }: Props) {
  const t = useTranslations('commercial.billing.collection.timeline');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>
          {t('title')}
          {invoice.invoiceNumber ? ` — ${invoice.invoiceNumber}` : ''}
        </DialogTitle>

        <div className="py-2">
          {entries.length === 0 ? (
            <p className="py-4 text-center text-body-sm text-muted-foreground">{t('noHistory')}</p>
          ) : (
            <TimelineList entries={entries} currency={currency} />
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Timeline list ────────────────────────────────────────────────────────────

function TimelineList({ entries, currency }: { entries: TimelineEntry[]; currency: string }) {
  return (
    <ol className="space-y-0">
      {entries.map((entry, i) => (
        <TimelineItem key={`${entry.kind}-${entry.at}-${i}`} entry={entry} currency={currency} />
      ))}
    </ol>
  );
}

function TimelineItem({ entry, currency }: { entry: TimelineEntry; currency: string }) {
  const t = useTranslations('commercial.billing.collection.timeline');
  const locale = useLocale() as 'en';

  const { icon, label, tone } = resolveEntryMeta(entry.kind, t);

  const dateDisplay =
    entry.at.includes('T')
      ? formatDate(entry.at.slice(0, 10), locale) ?? entry.at.slice(0, 10)
      : formatDate(entry.at, locale) ?? entry.at;

  const amountDisplay =
    entry.detail && !isNaN(parseFloat(entry.detail))
      ? (formatMoney(entry.detail, currency, locale) ?? entry.detail)
      : null;

  return (
    <li className="relative flex gap-3 pb-6 last:pb-0">
      {/* Vertical connector line */}
      <div className="absolute left-3.5 top-7 bottom-0 w-px bg-border last:hidden" aria-hidden />

      {/* Icon */}
      <div
        className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 ${tone.ring} ${tone.bg}`}
      >
        {icon}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-body-sm font-medium text-foreground">{label}</p>
        {entry.detail2 && entry.kind === 'FOLLOW_UP' ? (
          <p className="text-caption text-muted-foreground">{t('contact', { person: entry.detail2 })}</p>
        ) : null}
        {entry.detail && entry.kind === 'PROMISE' ? (
          <p className="text-caption text-muted-foreground">
            {t('promisedBy', { date: formatDate(entry.detail, locale) ?? entry.detail })}
            {amountDisplay ? ` · ${amountDisplay}` : ''}
          </p>
        ) : null}
        {entry.detail && entry.kind === 'PROMISE_MISSED' ? (
          <p className="text-caption text-danger">
            {t('promisedBy', { date: formatDate(entry.detail, locale) ?? entry.detail })}
            {amountDisplay ? ` · ${amountDisplay}` : ''}
          </p>
        ) : null}
        {entry.detail && entry.kind === 'PAYMENT' ? (
          <p className="text-caption text-muted-foreground">
            {amountDisplay ?? entry.detail}
            {entry.detail2 ? ` · ${entry.detail2}` : ''}
          </p>
        ) : null}
        <p className="mt-0.5 text-micro text-muted-foreground">{dateDisplay}</p>
      </div>
    </li>
  );
}

// ─── Icon / tone resolver ─────────────────────────────────────────────────────

type EntryTone = {
  bg: string;
  ring: string;
  icon: string;
};

function resolveEntryMeta(
  kind: TimelineEventKind,
  t: ReturnType<typeof useTranslations<'commercial.billing.collection.timeline'>>,
): {
  icon: React.ReactNode;
  label: string;
  tone: { bg: string; ring: string };
} {
  switch (kind) {
    case 'ISSUED':
      return {
        icon: <FileText size={13} className="text-muted-foreground" />,
        label: t('issued'),
        tone: { bg: 'bg-surface', ring: 'border-border' },
      };
    case 'SENT':
      return {
        icon: <Send size={13} className="text-brand-primary" />,
        label: t('sent'),
        tone: { bg: 'bg-surface', ring: 'border-brand-primary/30' },
      };
    case 'FOLLOW_UP':
      return {
        icon: <MessageSquare size={13} className="text-brand-primary" />,
        label: t('followUp', { method: '' }).replace(' — ', ''),
        tone: { bg: 'bg-brand-primary/5', ring: 'border-brand-primary/20' },
      };
    case 'PROMISE':
      return {
        icon: <Clock size={13} className="text-warning" />,
        label: t('promise'),
        tone: { bg: 'bg-warning/5', ring: 'border-warning/30' },
      };
    case 'PROMISE_MISSED':
      return {
        icon: <TriangleAlert size={13} className="text-danger" />,
        label: t('promiseMissed'),
        tone: { bg: 'bg-danger/5', ring: 'border-danger/30' },
      };
    case 'DISPUTE':
      return {
        icon: <ShieldAlert size={13} className="text-danger" />,
        label: t('dispute'),
        tone: { bg: 'bg-danger/5', ring: 'border-danger/30' },
      };
    case 'DISPUTE_RESOLVED':
      return {
        icon: <ShieldCheck size={13} className="text-success" />,
        label: t('disputeResolved'),
        tone: { bg: 'bg-success/5', ring: 'border-success/30' },
      };
    case 'PAYMENT':
      return {
        icon: <CircleDollarSign size={13} className="text-success" />,
        label: t('payment'),
        tone: { bg: 'bg-success/5', ring: 'border-success/30' },
      };
    default:
      return {
        icon: <BadgeCheck size={13} className="text-muted-foreground" />,
        label: kind,
        tone: { bg: 'bg-surface', ring: 'border-border' },
      };
  }
}
