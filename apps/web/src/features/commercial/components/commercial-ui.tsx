'use client';

import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { Button, cn } from '@erp/ui';
import type { CommercialAttentionItem } from '@erp/types';

/**
 * A panel.
 *
 * Same recipe as the project overview's information cards and the BOQ grid: bordered,
 * `rounded-panel`, no shadow — separation is a border, not elevation. It previously used
 * `bg-card`, which is not a token in this theme, so these panels rendered transparent over
 * the page background and lost their edge in dark mode.
 */
export function SectionCard({
  title,
  action,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cn('min-w-0 overflow-hidden rounded-panel border border-border bg-surface', className)}
    >
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-4 sm:px-5">
        <h2 className="text-body-sm font-semibold text-foreground">{title}</h2>
        {action}
      </div>
      <div className={cn('px-4 py-3 sm:px-5', bodyClassName)}>{children}</div>
    </section>
  );
}

/** A label/value row. Inner rules are lighter than the panel's own edge. */
export function FactRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(7rem,0.9fr)_minmax(0,1.1fr)] gap-4 border-b border-border/70 py-2.5 last:border-b-0">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="text-end text-body-sm font-medium tabular-nums text-foreground">{children}</dd>
    </div>
  );
}

/** A panel link — "View terms", "Open guarantees". 44px tall on touch, quiet on desktop. */
export function PanelLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 shrink-0 items-center text-caption font-medium text-brand-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary sm:min-h-0"
    >
      {children}
    </Link>
  );
}

/**
 * One panel failed; the page did not.
 *
 * The commercial summary is assembled with `Promise.allSettled` precisely so a dead
 * guarantee query cannot take the contract position down with it. That only pays off if the
 * UI degrades per panel — which until now meant a copy-pasted Alert and refetch button in
 * two files and nothing in the rest.
 */
export function PanelError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useTranslations('commercial');

  return (
    <div className="flex flex-col items-start gap-2 py-2">
      <p className="inline-flex items-start gap-2 text-body-sm text-muted-foreground">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
        {message}
      </p>
      {onRetry ? (
        <Button variant="outline" size="sm" className="min-h-11 gap-2 sm:min-h-0" onClick={onRetry}>
          <RotateCw size={14} aria-hidden="true" />
          {t('actions.retry')}
        </Button>
      ) : null}
    </div>
  );
}

const SEVERITY_ACCENT: Record<CommercialAttentionItem['severity'], string> = {
  URGENT: 'text-danger',
  WARNING: 'text-warning',
  INFO: 'text-muted-foreground',
};

/**
 * What needs doing, as one operational list.
 *
 * A list, not three stacked alert cards: these are peers competing for the same attention,
 * and giving each its own panel makes the third look less important than the first purely
 * because of where it landed. Severity is carried by a small coloured marker rather than a
 * badge — the row already says what happened, and a row of badges reads as decoration.
 *
 * `actionUrl` is null server-side when the user cannot act, so a disabled control is never
 * rendered.
 */
export function AttentionList({ items }: { items: CommercialAttentionItem[] }) {
  const t = useTranslations('commercial.attention');

  if (items.length === 0) {
    return <p className="py-2 text-body-sm text-muted-foreground">{t('none')}</p>;
  }

  return (
    <ul className="divide-y divide-border/70">
      {items.map((item) => (
        <li
          key={item.id}
          className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
        >
          <div className="flex min-w-0 items-start gap-2.5">
            <AlertTriangle
              size={16}
              className={cn('mt-0.5 shrink-0', SEVERITY_ACCENT[item.severity])}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="text-body-sm font-medium text-foreground">{t(`${item.kind}.title`)}</p>
              <p className="mt-0.5 text-caption text-muted-foreground">
                {t(`${item.kind}.impact`)}
              </p>
            </div>
          </div>

          {item.actionUrl ? (
            <Button
              asChild
              variant="outline"
              size="sm"
              className="min-h-11 shrink-0 self-start sm:min-h-0 sm:self-center"
            >
              <Link href={item.actionUrl}>{t(`${item.kind}.action`)}</Link>
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
