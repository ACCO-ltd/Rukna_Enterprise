'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button } from '@erp/ui';

import { formatMoney } from '@/lib/format';

import { resolveSubtreeCurrency } from '../subtree-currency';
import type { BoqTreeNode } from '../types';
import { BoqTreeRow } from './boq-tree-row';

/** Sorts siblings by sortOrder at every level. */
function sortTree(nodes: BoqTreeNode[]): BoqTreeNode[] {
  return [...nodes]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((node) => ({ ...node, children: sortTree(node.children) }));
}

function collectIds(nodes: BoqTreeNode[], into: string[] = []): string[] {
  for (const node of nodes) {
    if (node.children.length > 0) {
      into.push(node.id);
      collectIds(node.children, into);
    }
  }
  return into;
}

function anySubtreeMixed(nodes: BoqTreeNode[]): boolean {
  return nodes.some(
    (node) => resolveSubtreeCurrency(node).kind === 'mixed' || anySubtreeMixed(node.children),
  );
}

export function BoqTree({ nodes }: { nodes: BoqTreeNode[] }) {
  const t = useTranslations('platform.boq');
  const locale = useLocale() as 'en' | 'ar';

  // The API orders by depth then sortOrder, but the tree should not depend on an
  // undocumented ordering — sort explicitly.
  const tree = useMemo(() => sortTree(nodes), [nodes]);
  const expandableIds = useMemo(() => collectIds(tree), [tree]);

  // Expanded by default: a BOQ is read top-to-bottom, and opening every section by hand
  // to see the priced items would be tedious.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = (nodeId: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const visible = useMemo(() => flatten(tree, collapsed), [tree, collapsed]);
  const allCollapsed = expandableIds.length > 0 && collapsed.size === expandableIds.length;
  const hasMixed = useMemo(() => anySubtreeMixed(tree), [tree]);

  const grandTotal = useMemo(() => computeGrandTotal(tree), [tree]);

  return (
    <div className="space-y-3">
      {hasMixed ? <Alert variant="warning" messages={[t('mixedCurrencyWarning')]} /> : null}

      {expandableIds.length > 0 ? (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setCollapsed(allCollapsed ? new Set() : new Set(expandableIds));
            }}
            className="min-h-11"
          >
            {allCollapsed ? t('expandAll') : t('collapseAll')}
          </Button>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-border">
        {/* Column headers exist only where the columns do — below `sm` the values are
            stacked into each row instead. */}
        <div className="hidden items-center gap-3 border-b border-border bg-muted px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:flex">
          <span className="flex-1">{t('columnDescription')}</span>
          <span className="w-16 text-end">{t('columnUnit')}</span>
          <span className="w-24 text-end">{t('columnQuantity')}</span>
          <span className="w-28 text-end">{t('columnRate')}</span>
          <span className="w-40 text-end">{t('columnTotal')}</span>
        </div>

        <div className="divide-y divide-border">
          {visible.map((node) => (
            <BoqTreeRow
              key={node.id}
              node={node}
              isExpanded={!collapsed.has(node.id)}
              onToggle={toggle}
            />
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border bg-muted px-3 py-3">
          <span className="text-sm font-semibold text-foreground">{t('grandTotal')}</span>
          <span className="text-sm font-semibold tabular-nums text-foreground sm:w-40 sm:text-end">
            {grandTotal.kind === 'mixed' ? (
              <span className="text-xs font-normal text-warning">{t('mixedCurrency')}</span>
            ) : (
              (formatMoney(grandTotal.amount, grandTotal.currency, locale) ?? t('noAmount'))
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Depth-first list of rows to render, skipping anything inside a collapsed section. */
function flatten(nodes: BoqTreeNode[], collapsed: Set<string>, into: BoqTreeNode[] = []) {
  for (const node of nodes) {
    into.push(node);
    if (!collapsed.has(node.id)) flatten(node.children, collapsed, into);
  }
  return into;
}

/**
 * Grand total across root sections.
 *
 * Withheld when the roots disagree on currency, for the same reason a section total is —
 * see subtree-currency.ts. Summing is done on the server's per-root `computedTotal`, which
 * is a display-time addition of already-computed figures, not a re-derivation of the BOQ.
 */
function computeGrandTotal(
  roots: BoqTreeNode[],
): { kind: 'mixed' } | { kind: 'ok'; amount: number | null; currency: string | null } {
  const currencies = new Set<string>();

  for (const root of roots) {
    const resolved = resolveSubtreeCurrency(root);
    if (resolved.kind === 'mixed') return { kind: 'mixed' };
    if (resolved.kind === 'single') currencies.add(resolved.currency);
  }

  if (currencies.size > 1) return { kind: 'mixed' };

  const amounts = roots.map((r) => r.computedTotal).filter((v): v is number => v !== null);
  const amount = amounts.length > 0 ? amounts.reduce((sum, v) => sum + v, 0) : null;

  return { kind: 'ok', amount, currency: currencies.size === 1 ? [...currencies][0]! : null };
}
