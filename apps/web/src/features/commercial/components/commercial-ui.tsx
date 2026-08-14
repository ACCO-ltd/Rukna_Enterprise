'use client';

import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';
import { Badge } from '@erp/ui';
import type { CommercialAttentionItem } from '@erp/types';

import { attentionSeverityTone } from '../presentation';

/** A compact, single-level card. No nested cards — the design language forbids them. */
export function SectionCard({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-panel border border-border bg-card p-4 ${className ?? ''}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-body-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A label/value row used inside a card. Values are right-aligned and tabular. */
export function FactRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-body-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-end font-medium tabular-nums text-foreground">{children}</span>
    </div>
  );
}

/**
 * The attention list. Each item explains what happened and, when the user is permitted,
 * offers the direct action. `actionUrl` is null server-side when the user cannot act, so a
 * disabled control is never rendered.
 */
export function AttentionList({ items }: { items: CommercialAttentionItem[] }) {
  const t = useTranslations('commercial.attention');

  if (items.length === 0) {
    return <p className="text-body-sm text-muted-foreground">{t('none')}</p>;
  }

  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li
          key={item.id}
          className="flex items-start gap-3 rounded-control border border-border bg-muted/40 p-3"
        >
          <AlertTriangle
            size={16}
            className="mt-0.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Badge tone={attentionSeverityTone(item.severity)}>
                {t(`severity.${item.severity}`)}
              </Badge>
              <span className="text-body-sm font-medium text-foreground">
                {t(`${item.kind}.title`)}
              </span>
            </div>
            <p className="mt-0.5 text-caption text-muted-foreground">{t(`${item.kind}.impact`)}</p>
          </div>
          {item.actionUrl ? (
            <Link
              href={item.actionUrl}
              className="inline-flex min-h-[44px] shrink-0 items-center self-center text-body-sm font-medium text-brand-primary hover:underline sm:min-h-0"
            >
              {t(`${item.kind}.action`)}
            </Link>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
