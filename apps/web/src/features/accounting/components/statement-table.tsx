'use client';

import Link from 'next/link';
import { useLocale } from 'next-intl';
import { cn } from '@erp/ui';

import { formatMoney } from '@/lib/format';
import { fromMinorUnits } from '@/lib/money';

import type { StatementLine } from '../statement';

/** A row of a statement: an account line, a section heading or total, or a summary (Gross profit). */
export type StatementBlock =
  | { kind: 'section'; key: string; label: string; lines: StatementLine[]; totals: number[]; totalLabel: string; hrefFor?: (accountId: string) => string }
  | { kind: 'summary'; key: string; label: string; amounts: number[]; strong?: boolean; note?: string };

/** Segmented preset buttons, shared by the report filters. */
export function PresetButtons<T extends string>({
  label,
  options,
  value,
  onChange,
  labelFor,
}: {
  label: string;
  options: readonly T[];
  value: T | null;
  onChange: (value: T) => void;
  labelFor: (value: T) => string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-wrap rounded-control border border-border p-0.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={value === o}
          onClick={() => onChange(o)}
          className={cn(
            'min-h-9 rounded-control px-2.5 text-caption font-medium',
            value === o ? 'bg-brand-accent text-brand-primary' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {labelFor(o)}
        </button>
      ))}
    </div>
  );
}

/**
 * R — one statement as one table: sections by class, sub-accounts indented under their heading,
 * a total under each section and summary lines (Gross profit, Net income) between them. Several
 * amount columns scroll sideways with the account column held in place.
 */
export function StatementTable({
  caption,
  columns,
  blocks,
}: {
  caption: string;
  columns: string[];
  blocks: StatementBlock[];
}) {
  const locale = useLocale() as 'en';
  const money = (minor: number) => formatMoney(fromMinorUnits(minor, 2), 'USD', locale) ?? '';
  const wide = columns.length > 2;

  return (
    <div className="min-w-0 overflow-hidden rounded-panel border border-border bg-surface">
      <div className="overflow-x-auto">
        <table className={cn('w-full text-body-sm', wide ? 'min-w-[960px]' : '')}>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-border bg-surface-subtle text-caption text-muted-foreground">
              <th scope="col" className={cn('sticky start-0 bg-surface-subtle px-4 py-2 text-start font-medium', wide && 'min-w-60')}>&nbsp;</th>
              {columns.map((c) => (
                <th key={c} scope="col" className="whitespace-nowrap px-3 py-2 text-end font-medium last:pe-4">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {blocks.map((block) =>
              block.kind === 'summary' ? (
                <tr key={block.key} className={cn('border-b border-border font-semibold', block.strong ? 'bg-brand-accent text-body' : 'bg-surface-subtle')}>
                  <th scope="row" className={cn('sticky start-0 px-4 py-2.5 text-start', block.strong ? 'bg-brand-accent' : 'bg-surface-subtle')}>
                    {block.label}
                    {block.note ? <span className="ms-2 text-caption font-normal text-muted-foreground">{block.note}</span> : null}
                  </th>
                  {block.amounts.map((m, i) => (
                    <td key={i} className={cn('whitespace-nowrap px-3 py-2.5 text-end tabular-nums last:pe-4', m < 0 && 'text-danger')}>{wide && m === 0 ? '' : money(m)}</td>
                  ))}
                </tr>
              ) : (
                <SectionRows key={block.key} block={block} money={money} wide={wide} />
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const INDENT = ['ps-4', 'ps-8', 'ps-12', 'ps-16', 'ps-20'];

function SectionRows({ block, money, wide }: { block: Extract<StatementBlock, { kind: 'section' }>; money: (m: number) => string; wide: boolean }) {
  return (
    <>
      <tr className="border-b border-border">
        <th scope="rowgroup" colSpan={block.totals.length + 1} className="px-4 pb-1 pt-4 text-start text-caption font-semibold uppercase tracking-wide text-muted-foreground">
          {block.label}
        </th>
      </tr>
      {block.lines.map((line) => {
        const href = !line.heading && block.hrefFor ? block.hrefFor(line.accountId) : null;
        const label = (
          <>
            {line.code ? <span className="me-2 font-mono text-caption text-muted-foreground">{line.code}</span> : null}
            {line.name}
          </>
        );
        return (
          <tr key={line.accountId} className="border-b border-border/60 hover:bg-surface-subtle">
            <th
              scope="row"
              className={cn('sticky start-0 bg-surface py-2 pe-4 text-start', INDENT[Math.min(line.depth, INDENT.length - 1)], line.heading ? 'font-semibold' : 'font-normal')}
            >
              {href ? (
                <Link href={href} className="text-foreground hover:text-brand-primary hover:underline">{label}</Link>
              ) : (
                label
              )}
            </th>
            {line.amounts.map((m, i) => (
              <td key={i} className={cn('whitespace-nowrap px-3 py-2 text-end tabular-nums last:pe-4', line.heading && 'font-semibold', m < 0 && 'text-danger')}>
                {m === 0 ? '' : money(m)}
              </td>
            ))}
          </tr>
        );
      })}
      <tr className="border-b border-border">
        <th scope="row" className="sticky start-0 bg-surface px-4 py-2 text-start font-semibold">{block.totalLabel}</th>
        {block.totals.map((m, i) => (
          <td key={i} className="whitespace-nowrap border-t border-border px-3 py-2 text-end font-semibold tabular-nums last:pe-4">{wide && m === 0 ? '' : money(m)}</td>
        ))}
      </tr>
    </>
  );
}
