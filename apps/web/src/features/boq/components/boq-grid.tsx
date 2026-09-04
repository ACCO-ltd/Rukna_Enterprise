'use client';

import { useRef, useState } from 'react';
import type { BoqTreeNodeResponse } from '@erp/types';
import { ChevronRight, LockKeyhole, MoreHorizontal, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  LtrValue,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  cn,
} from '@erp/ui';

import { formatMoney, formatNumber } from '@/lib/format';

import { clamp, isNavigationKey, resolveKeyIntent } from '../boq-keyboard';
import { isIncomplete, type BoqRow } from '../boq-rows';
import { EditableCell } from './boq-editable-cell';

export interface BoqRowCommands {
  onEdit: (node: BoqTreeNodeResponse) => void;
  onAddSection: (parent: BoqTreeNodeResponse) => void;
  onAddItem: (parent: BoqTreeNodeResponse) => void;
  onDelete: (node: BoqTreeNodeResponse) => void;
  onMove: (node: BoqTreeNodeResponse, direction: -1 | 1) => void;
  /** Opens the change log filtered to this line (BOQ refinement Phase 1). Optional. */
  onViewHistory?: (node: BoqTreeNodeResponse) => void;
  /**
   * Inline field edit (BOQ refinement Phase 5). Resolves when persisted, rejects on failure so the
   * cell can show a retry. Present only when the version is an editable draft.
   */
  onEditField?: (
    node: BoqTreeNodeResponse,
    field: 'description' | 'quantity' | 'unitRate',
    value: string,
  ) => Promise<void>;
}

/**
 * The BOQ grid.
 *
 * A real `<table>` this time. The previous implementation was flexbox `div`s with
 * hand-tuned widths (`w-16`, `w-24`, `w-28`, `w-40`), which meant no sticky header, no
 * column alignment down the page, and nothing for a screen reader to announce as a table —
 * on the most number-dense screen in the product.
 *
 * Wide content scrolls inside `TableScroll`; the page body never scrolls sideways. Every
 * numeric cell is `tabular-nums` and wrapped in `LtrValue`, without which a rate reverses
 * in Arabic — `tabular-nums` does not fix bidi.
 */
export function BoqGrid({
  rows,
  totalRows,
  currency,
  totalAmount,
  visibleAmount,
  sectionTotals,
  isFiltered,
  canManage,
  canViewCommercials,
  highlighted,
  collapsed,
  onToggle,
  onSelect,
  commands,
  emptyMessage,
}: {
  rows: BoqRow[];
  totalRows: number;
  currency: string;
  totalAmount: string | null;
  /** Sum of the items currently visible. Shown only while a filter narrows the list. */
  visibleAmount: string | null;
  /**
   * Section id → client-rolled-up subtotal (decimal string, or null when unpriced). Computed
   * once in the workspace from the tree and memoized, so a section shows the sum of its own
   * descendant leaves rather than each leaf being read in isolation.
   */
  sectionTotals: ReadonlyMap<string, string | null>;
  isFiltered: boolean;
  canManage: boolean;
  canViewCommercials: boolean;
  /** Node ids the readiness banner asked to draw attention to. */
  highlighted: ReadonlySet<string>;
  collapsed: ReadonlySet<string>;
  onToggle: (nodeId: string) => void;
  onSelect: (node: BoqTreeNodeResponse) => void;
  commands: BoqRowCommands | null;
  emptyMessage: string;
}) {
  const t = useTranslations('platform.boq.grid');
  const locale = useLocale() as 'en' | 'ar';
  const bodyRef = useRef<HTMLTableSectionElement>(null);

  // Roving tab stop: one row is reachable by Tab, the arrows move between them. Sixty-seven
  // individually tabbable rows would be worse than none.
  const [focusIndex, setFocusIndex] = useState(0);
  const activeIndex = clamp(focusIndex, rows.length);

  const columnCount = canViewCommercials ? 9 : 7;

  const focusRow = (index: number) => {
    setFocusIndex(index);
    bodyRef.current?.querySelectorAll<HTMLTableRowElement>('tr')[index]?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTableSectionElement>) => {
    // Let a control inside the row keep its own keys — Enter on the ⋯ trigger should open
    // the menu, not the item drawer.
    if (event.target !== event.currentTarget && !(event.target as HTMLElement).matches('tr')) {
      return;
    }
    if (!isNavigationKey(event.key)) return;

    const intent = resolveKeyIntent(event.key, activeIndex, rows, false);
    if (!intent) return;

    event.preventDefault();
    if (intent.type === 'focus') focusRow(intent.index);
    else if (intent.type === 'toggle') onToggle(intent.nodeId);
    else if (intent.type === 'open') onSelect(rows[intent.index]!.node);
  };

  return (
    <div className="overflow-hidden rounded-panel border border-border bg-surface">
      <TableScroll className="rounded-none border-0">
        {/* `role="grid"` announces this as navigable with the arrow keys. The native table
            semantics underneath are untouched. */}
        <Table role="grid">
          <TableHeader className="sticky top-0 z-10 shadow-e1">
            <TableRow className="hover:bg-surface-subtle">
              {/* Fixed, and pinned. Fixed because the auto layout was handing slack to the
                  code column and starving the description; pinned because between ~375 and
                  1100px this grid scrolls sideways, and a rate with no visible item code
                  beside it is a number nobody can act on. */}
              <TableHead className="sticky start-0 z-20 w-56 border-e border-border bg-surface-subtle">
                {t('code')}
              </TableHead>
              {/* Takes every spare pixel, so wide viewports widen the column that benefits. */}
              <TableHead className="w-full min-w-64">{t('description')}</TableHead>
              <TableHead className="whitespace-nowrap">{t('type')}</TableHead>
              <TableHead className="whitespace-nowrap">{t('unit')}</TableHead>
              <TableHead numeric className="whitespace-nowrap">
                {t('quantity')}
              </TableHead>
              {canViewCommercials ? (
                <>
                  <TableHead numeric className="whitespace-nowrap">
                    {t('rate', { currency })}
                  </TableHead>
                  <TableHead numeric className="whitespace-nowrap">
                    {t('amount', { currency })}
                  </TableHead>
                </>
              ) : null}
              <TableHead className="whitespace-nowrap">{t('source')}</TableHead>
              <TableHead className="w-12">
                <span className="sr-only">{t('actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>

          <TableBody ref={bodyRef} onKeyDown={handleKeyDown}>
            {rows.length === 0 ? (
              <TableEmpty colSpan={columnCount}>{emptyMessage}</TableEmpty>
            ) : (
              rows.map((row, index) => (
                <GridRow
                  key={row.node.id}
                  row={row}
                  currency={currency}
                  locale={locale}
                  canManage={canManage}
                  canViewCommercials={canViewCommercials}
                  sectionTotal={
                    row.node.isLeaf ? undefined : (sectionTotals.get(row.node.id) ?? null)
                  }
                  highlighted={highlighted.has(row.node.id)}
                  collapsed={collapsed.has(row.node.id)}
                  tabbable={index === activeIndex}
                  onFocus={() => setFocusIndex(index)}
                  onToggle={onToggle}
                  onSelect={onSelect}
                  commands={commands}
                />
              ))
            )}
          </TableBody>
        </Table>
      </TableScroll>

      {/* Footer. "26 of 67 rows" used to sit beside a total covering all 67, so a filtered
          view showed a count and a figure that did not describe the same thing. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface-subtle px-4 py-3 sm:px-5">
        <span className="text-caption text-muted-foreground">
          {t('showingRows', { shown: rows.length, total: totalRows })}
        </span>
        {canViewCommercials ? (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {isFiltered ? (
              <>
                <span className="text-caption text-muted-foreground">
                  {t('visibleTotal')}{' '}
                  <LtrValue className="font-medium tabular-nums text-foreground">
                    {formatMoney(visibleAmount, currency, locale) ?? '—'}
                  </LtrValue>
                </span>
                <span className="text-muted-foreground" aria-hidden="true">
                  ·
                </span>
              </>
            ) : null}
            <span className="text-body-sm font-semibold text-foreground">
              {t('boqTotal')}{' '}
              <LtrValue className="tabular-nums">
                {formatMoney(totalAmount, currency, locale) ?? '—'}
              </LtrValue>
            </span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-caption font-medium text-muted-foreground">
            <LockKeyhole size={14} aria-hidden="true" />
            {t('totalRestricted')}
          </span>
        )}
      </div>
    </div>
  );
}

function GridRow({
  row,
  currency,
  locale,
  canManage,
  canViewCommercials,
  sectionTotal,
  highlighted,
  collapsed,
  tabbable,
  onFocus,
  onToggle,
  onSelect,
  commands,
}: {
  row: BoqRow;
  currency: string;
  locale: 'en' | 'ar';
  canManage: boolean;
  canViewCommercials: boolean;
  /** A section's client-rolled-up subtotal. `undefined` for a leaf (which uses computedTotal). */
  sectionTotal?: string | null;
  highlighted: boolean;
  collapsed: boolean;
  /** True for the single row holding the grid's tab stop. */
  tabbable: boolean;
  onFocus: () => void;
  onToggle: (nodeId: string) => void;
  onSelect: (node: BoqTreeNodeResponse) => void;
  commands: BoqRowCommands | null;
}) {
  const t = useTranslations('platform.boq.grid');
  const { node, depth, hasChildren } = row;
  const incomplete = isIncomplete(node);
  // Present only on an editable draft (the workspace withholds it otherwise), so its presence is
  // the signal that cells accept inline edits.
  const edit = commands?.onEditField;

  // The sticky cell needs its own opaque background or the columns scrolling underneath
  // show through it. It has to track the row's state, not just default to the surface.
  const stickyBackground = highlighted
    ? 'bg-warning-subtle'
    : node.isLeaf
      ? 'bg-surface'
      : 'bg-[color-mix(in_oklab,var(--surface-subtle)_60%,var(--surface))]';

  return (
    <TableRow
      onClick={() => onSelect(node)}
      onFocus={onFocus}
      tabIndex={tabbable ? 0 : -1}
      aria-expanded={hasChildren ? !collapsed : undefined}
      className={cn(
        'cursor-pointer',
        'focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-brand-primary',
        // Sections read as structure, items as data. Restrained: a tint and a weight, not a
        // second background colour per level.
        !node.isLeaf && 'bg-surface-subtle/60 font-medium',
        // An unpriced row carries an amber leading edge rather than a 6px dot. A dot is
        // invisible while scrolling 400 rows, which is exactly when it matters; an edge is
        // the only thing at this density the eye can catch in peripheral vision.
        incomplete && 'border-s-2 border-s-warning',
        // The result of pressing "Show these" — the rows asked for, tinted so the jump is
        // visibly the answer to the button.
        highlighted && 'bg-warning-subtle',
        !node.isActive && 'opacity-60',
      )}
    >
      <TableCell
        className={cn(
          'sticky start-0 z-10 w-56 whitespace-nowrap border-e border-border',
          stickyBackground,
        )}
      >
        {/* Logical inline padding, so the indent flows from the trailing edge in RTL. */}
        <div className="flex items-center gap-1" style={{ paddingInlineStart: depth * 1.25 + 'rem' }}>
          {hasChildren ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onToggle(node.id);
              }}
              aria-expanded={!collapsed}
              aria-label={collapsed ? t('expand') : t('collapse')}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"
            >
              <ChevronRight
                size={14}
                className={cn('transition-transform rtl:rotate-180', !collapsed && 'rotate-90 rtl:rotate-90')}
                aria-hidden="true"
              />
            </button>
          ) : (
            <span className="h-7 w-7 shrink-0" aria-hidden="true" />
          )}
          <LtrValue className="font-mono text-caption">{node.code}</LtrValue>
          {incomplete ? <span className="sr-only">{t('incomplete')}</span> : null}
        </div>
      </TableCell>

      <TableCell>
        <EditableCell
          editable={Boolean(edit)}
          value={node.description}
          kind="text"
          ariaLabel={t('editDescription', { code: node.code })}
          onCommit={edit ? (next) => edit(node, 'description', next) : async () => {}}
          display={
            <span className={cn('block truncate', !node.isLeaf && 'text-foreground')}>
              {node.description}
            </span>
          }
        />
      </TableCell>

      {/* TYPE and UNIT are the quietest columns on the row and should look it.
          `text-muted-foreground` is the sanctioned secondary-text token. An earlier attempt
          used `text-foreground/55` to dodge the faint blue cast these read with at 12px —
          measured, the composite is still cool, because `--foreground` is itself a navy and
          every grey in the ramp inherits that. Fighting it here only produced an off-system
          value on one screen; a warmer ramp is a token decision for the whole product. */}
      <TableCell className="text-caption text-muted-foreground">
        {node.isLeaf ? t('typeItem') : t('typeSection')}
      </TableCell>

      <TableCell className="text-caption text-muted-foreground">
        {node.isLeaf ? (node.unit ?? '—') : ''}
      </TableCell>

      <TableCell numeric>
        <EditableCell
          editable={Boolean(edit) && node.isLeaf}
          value={node.quantity}
          kind="quantity"
          numeric
          ariaLabel={t('editQuantity', { code: node.code })}
          onCommit={edit ? (next) => edit(node, 'quantity', next) : async () => {}}
          display={
            node.quantity ? (
              <LtrValue>{formatNumber(Number(node.quantity), locale, 3)}</LtrValue>
            ) : (
              <span className="text-muted-foreground">{node.isLeaf ? '—' : ''}</span>
            )
          }
        />
      </TableCell>

      {canViewCommercials ? (
        <>
          <TableCell numeric>
            <EditableCell
              editable={Boolean(edit) && node.isLeaf}
              value={node.unitRate}
              kind="rate"
              numeric
              ariaLabel={t('editRate', { code: node.code })}
              onCommit={edit ? (next) => edit(node, 'unitRate', next) : async () => {}}
              display={
                node.unitRate ? (
                  <LtrValue>{formatNumber(Number(node.unitRate), locale, 2)}</LtrValue>
                ) : (
                  <span className="text-muted-foreground">{node.isLeaf ? '—' : ''}</span>
                )
              }
            />
          </TableCell>
          {/* A section shows its client-rolled-up subtotal — the sum of its own descendant
              leaves — computed once in the workspace and memoized. A leaf shows its own
              server-computed line amount. Both are right-aligned and tabular so subtotals line
              up down the column against the items they roll up. */}
          <TableCell numeric className={cn(!node.isLeaf && 'font-semibold')}>
            {(() => {
              const amount = node.isLeaf ? node.computedTotal : (sectionTotal ?? null);
              return amount ? (
                <LtrValue>{formatMoney(amount, currency, locale)}</LtrValue>
              ) : (
                <span className="text-muted-foreground">—</span>
              );
            })()}
          </TableCell>
        </>
      ) : null}

      <TableCell>
        <SourceCell node={node} />
      </TableCell>

      <TableCell className="w-12">
        {commands && canManage ? (
          <RowMenu node={node} commands={commands} />
        ) : null}
      </TableCell>
    </TableRow>
  );
}

/**
 * Where this line came from.
 *
 * `sourceType` and `sourceChangeOrderId` have been on `BoqNode` since Sprint 5, unread.
 * Rendering them now means the column is already correct when Variations ships — the
 * variation reference just becomes a link.
 */
function SourceCell({ node }: { node: BoqTreeNodeResponse }) {
  const t = useTranslations('platform.boq.grid');

  if (node.sourceType === 'VARIATION') {
    return (
      <Badge tone="info">
        {node.sourceChangeOrderId
          ? t('sourceVariationRef', { ref: node.sourceChangeOrderId })
          : t('sourceVariation')}
      </Badge>
    );
  }

  return <span className="text-caption text-muted-foreground">{t('sourceBaseline')}</span>;
}

/**
 * One menu, not six buttons.
 *
 * Each row used to carry up to six 44×44 icon buttons — a toolbar repeated 426 times, which
 * decided the table's width at 375px and drowned the data it sat next to. `RowActions`
 * documents this rule; the BOQ was the screen that most needed it.
 */
function RowMenu({ node, commands }: { node: BoqTreeNodeResponse; commands: BoqRowCommands }) {
  const t = useTranslations('platform.boq.grid');

  return (
    <div onClick={(event) => event.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t('rowMenu', { code: node.code })}>
            <MoreHorizontal size={16} aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => commands.onEdit(node)}>{t('edit')}</DropdownMenuItem>

          {commands.onViewHistory ? (
            <DropdownMenuItem onSelect={() => commands.onViewHistory!(node)}>
              {t('viewHistory')}
            </DropdownMenuItem>
          ) : null}

          {!node.isLeaf ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => commands.onAddItem(node)}>
                <Plus size={14} aria-hidden="true" />
                {t('addItem')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => commands.onAddSection(node)}>
                <Plus size={14} aria-hidden="true" />
                {t('addSubsection')}
              </DropdownMenuItem>
            </>
          ) : null}

          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => commands.onMove(node, -1)}>
            {t('moveUp')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => commands.onMove(node, 1)}>
            {t('moveDown')}
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => commands.onDelete(node)}>
            {t('delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
