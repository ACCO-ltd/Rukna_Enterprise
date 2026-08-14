'use client';

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

import { isIncomplete, type BoqRow } from '../boq-rows';

export interface BoqRowCommands {
  onEdit: (node: BoqTreeNodeResponse) => void;
  onAddSection: (parent: BoqTreeNodeResponse) => void;
  onAddItem: (parent: BoqTreeNodeResponse) => void;
  onDelete: (node: BoqTreeNodeResponse) => void;
  onMove: (node: BoqTreeNodeResponse, direction: -1 | 1) => void;
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

  const columnCount = canViewCommercials ? 9 : 7;

  return (
    <div className="overflow-hidden rounded-panel border border-border bg-surface">
      <TableScroll className="rounded-none border-0">
        <Table>
          <TableHeader className="sticky top-0 z-10 shadow-e1">
            <TableRow className="hover:bg-surface-subtle">
              <TableHead className="min-w-40">{t('code')}</TableHead>
              <TableHead className="min-w-64">{t('description')}</TableHead>
              <TableHead>{t('type')}</TableHead>
              <TableHead>{t('unit')}</TableHead>
              <TableHead numeric>{t('quantity')}</TableHead>
              {canViewCommercials ? (
                <>
                  <TableHead numeric>{t('rate', { currency })}</TableHead>
                  <TableHead numeric>{t('amount', { currency })}</TableHead>
                </>
              ) : null}
              <TableHead>{t('source')}</TableHead>
              <TableHead className="w-12">
                <span className="sr-only">{t('actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {rows.length === 0 ? (
              <TableEmpty colSpan={columnCount}>{emptyMessage}</TableEmpty>
            ) : (
              rows.map((row) => (
                <GridRow
                  key={row.node.id}
                  row={row}
                  currency={currency}
                  locale={locale}
                  canManage={canManage}
                  canViewCommercials={canViewCommercials}
                  highlighted={highlighted.has(row.node.id)}
                  collapsed={collapsed.has(row.node.id)}
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
  highlighted,
  collapsed,
  onToggle,
  onSelect,
  commands,
}: {
  row: BoqRow;
  currency: string;
  locale: 'en' | 'ar';
  canManage: boolean;
  canViewCommercials: boolean;
  highlighted: boolean;
  collapsed: boolean;
  onToggle: (nodeId: string) => void;
  onSelect: (node: BoqTreeNodeResponse) => void;
  commands: BoqRowCommands | null;
}) {
  const t = useTranslations('platform.boq.grid');
  const { node, depth, hasChildren } = row;
  const incomplete = isIncomplete(node);

  return (
    <TableRow
      onClick={() => onSelect(node)}
      className={cn(
        'cursor-pointer',
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
      <TableCell className="whitespace-nowrap">
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
        <span className={cn('block truncate', !node.isLeaf && 'text-foreground')}>
          {node.description}
        </span>
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

      <TableCell className="text-caption text-muted-foreground">{node.unit ?? '—'}</TableCell>

      <TableCell numeric>
        {node.quantity ? (
          <LtrValue>{formatNumber(Number(node.quantity), locale, 3)}</LtrValue>
        ) : (
          <span className="text-muted-foreground">{node.isLeaf ? '—' : ''}</span>
        )}
      </TableCell>

      {canViewCommercials ? (
        <>
          <TableCell numeric>
            {node.unitRate ? (
              <LtrValue>{formatNumber(Number(node.unitRate), locale, 2)}</LtrValue>
            ) : (
              <span className="text-muted-foreground">{node.isLeaf ? '—' : ''}</span>
            )}
          </TableCell>
          <TableCell numeric className={cn(!node.isLeaf && 'font-semibold')}>
            {node.computedTotal ? (
              <LtrValue>{formatMoney(node.computedTotal, currency, locale)}</LtrValue>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
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
