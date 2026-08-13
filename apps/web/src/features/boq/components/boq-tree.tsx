'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button } from '@erp/ui';

import { formatMoney } from '@/lib/format';

import { resolveSubtreeCurrency } from '../subtree-currency';
import type { BoqTreeNode } from '../types';
import { BoqTreeRow, type NodeRowCommands } from './boq-tree-row';

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

export function BoqTree({
  nodes,
  commands,
}: {
  nodes: BoqTreeNode[];
  /** Present only for the editable draft. */
  commands?: NodeRowCommands | undefined;
}) {
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

  // Each row needs its sibling set to decide whether it can move up or down.
  const visible = useMemo(() => flatten(tree, collapsed, tree), [tree, collapsed]);
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

      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-panel)]">
        {/* Column headers exist only where the columns do — below `sm` the values are
            stacked into each row instead. */}
        <div className="hidden min-h-11 items-center gap-3 border-b border-border bg-surface-subtle px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:flex">
          <span className="flex-1">{t('columnDescription')}</span>
          <span className="w-16 text-end">{t('columnUnit')}</span>
          <span className="w-24 text-end">{t('columnQuantity')}</span>
          <span className="w-28 text-end">{t('columnRate')}</span>
          <span className="w-40 text-end">{t('columnTotal')}</span>
        </div>

        <div className="divide-y divide-border">
          {visible.map(({ node, siblings }) => (
            <BoqTreeRow
              key={node.id}
              node={node}
              isExpanded={!collapsed.has(node.id)}
              onToggle={toggle}
              siblings={siblings}
              commands={commands}
            />
          ))}
        </div>

        <div className="flex min-h-14 items-center justify-between gap-3 border-t border-border-strong bg-brand-accent/35 px-4 py-3">
          <span className="text-sm font-bold text-foreground">{t('grandTotal')}</span>
          <span className="font-mono text-sm font-bold tabular-nums text-foreground sm:w-40 sm:text-end">
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

interface VisibleRow {
  node: BoqTreeNode;
  /** The list this node belongs to, carried so the row can decide about reordering. */
  siblings: BoqTreeNode[];
}

/** Depth-first list of rows to render, skipping anything inside a collapsed section. */
function flatten(
  nodes: BoqTreeNode[],
  collapsed: Set<string>,
  siblings: BoqTreeNode[],
  into: VisibleRow[] = [],
): VisibleRow[] {
  for (const node of nodes) {
    into.push({ node, siblings });
    if (!collapsed.has(node.id)) flatten(node.children, collapsed, node.children, into);
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
