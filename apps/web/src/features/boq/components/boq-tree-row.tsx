'use client';

import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@erp/ui';

import { formatMoney, formatNumber } from '@/lib/format';

import { resolveSubtreeCurrency } from '../subtree-currency';
import type { BoqTreeNode } from '../types';

interface BoqTreeRowProps {
  node: BoqTreeNode;
  isExpanded: boolean;
  onToggle: (nodeId: string) => void;
}

/** Indent per level. Padding-inline-start, so it mirrors correctly under RTL. */
const INDENT_REM = 1.25;

export function BoqTreeRow({ node, isExpanded, onToggle }: BoqTreeRowProps) {
  const t = useTranslations('platform.boq');
  const locale = useLocale() as 'en' | 'ar';

  const hasChildren = node.children.length > 0;
  const description = locale === 'ar' && node.descriptionAr ? node.descriptionAr : node.description;
  const currency = resolveSubtreeCurrency(node);

  const amount =
    currency.kind === 'mixed'
      ? null
      : formatMoney(node.computedTotal, currency.kind === 'single' ? currency.currency : null, locale);

  return (
    <div
      className={cn(
        'flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3',
        // Summary rows carry weight; leaves are the priced detail.
        node.isLeaf ? 'bg-surface' : 'bg-surface-subtle font-medium',
      )}
    >
      <div
        className="flex min-w-0 flex-1 items-start gap-2"
        style={{ paddingInlineStart: `${String(node.depth * INDENT_REM)}rem` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => {
              onToggle(node.id);
            }}
            // 44px touch target; -my-2 keeps it from stretching the row.
            className="-my-2 flex h-11 w-6 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
            aria-label={isExpanded ? t('collapse', { code: node.code }) : t('expand', { code: node.code })}
            aria-expanded={isExpanded}
          >
            <Chevron isExpanded={isExpanded} />
          </button>
        ) : (
          <span className="w-6 shrink-0" aria-hidden="true" />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="font-mono text-xs text-muted-foreground">{node.code}</span>
            <span className="min-w-0 text-sm text-foreground">{description}</span>
          </div>

          {/* Quantity × rate belongs with the description on mobile, where the columns
              on the right collapse away. */}
          {node.isLeaf && node.quantity !== null ? (
            <p className="mt-0.5 text-xs text-muted-foreground sm:hidden">
              {formatNumber(node.quantity, locale)} {node.unit ?? ''}
              {node.unitRate !== null
                ? ` × ${formatMoney(node.unitRate, node.currency, locale) ?? ''}`
                : ''}
            </p>
          ) : null}
        </div>
      </div>

      <div className="hidden shrink-0 items-baseline gap-3 sm:flex">
        <span className="w-16 text-end text-xs text-muted-foreground">{node.unit ?? ''}</span>
        <span className="w-24 text-end text-xs tabular-nums text-muted-foreground">
          {formatNumber(node.quantity, locale) ?? ''}
        </span>
        <span className="w-28 text-end text-xs tabular-nums text-muted-foreground">
          {formatMoney(node.unitRate, node.currency, locale) ?? ''}
        </span>
      </div>

      <div className="shrink-0 text-sm tabular-nums sm:w-40 sm:text-end">
        {currency.kind === 'mixed' ? (
          // D1: the server sums across currencies without checking them. Printing that
          // number with one symbol would be confidently wrong, so it is withheld.
          <span
            className="text-xs font-normal text-warning"
            title={t('mixedCurrencyDetail', { currencies: currency.currencies.join(', ') })}
          >
            {t('mixedCurrency')}
          </span>
        ) : (
          <span className={cn(!node.isLeaf && 'font-semibold', 'text-foreground')}>
            {amount ?? <span className="text-muted-foreground">{t('noAmount')}</span>}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Expanded points down in both directions. Collapsed points along the reading direction —
 * right in LTR, left in RTL — so the paths are swapped rather than rotated. A rotation
 * would have to differ per direction and is easy to get subtly wrong.
 */
function Chevron({ isExpanded }: { isExpanded: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {isExpanded ? (
        <path d="M2 4l4 4 4-4" />
      ) : (
        <>
          <path d="M4 2l4 4-4 4" className="rtl:hidden" />
          <path d="M8 2L4 6l4 4" className="hidden rtl:block" />
        </>
      )}
    </svg>
  );
}
