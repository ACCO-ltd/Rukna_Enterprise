'use client';

import { useRef, useState } from 'react';
import type { BoqTreeNodeResponse, UnitOfMeasureOption } from '@erp/types';
import { ChevronRight, CircleDollarSign, Diamond, Lock, MoreHorizontal, Plus, Receipt } from 'lucide-react';
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
import {
  acceptsItems,
  acceptsSections,
  countDescendants,
  withAddRows,
  type BoqRow,
  type GridEntry,
} from '../boq-rows';
import { currencySymbol } from '../currency-symbol';
import { lumpSumOf } from '../node-form';
import { CellEditor } from './boq-cell-editor';
import { UnitCellEditor } from './boq-unit-select';

/**
 * `lumpSumAmount`: the rate cell of a lump-sum line edits its one fixed amount, which is saved as
 * quantity 1 × rate = amount (node-form.ts).
 */
export type EditableField = 'description' | 'unit' | 'quantity' | 'unitRate' | 'lumpSumAmount';

export interface BoqRowCommands {
  /** "Edit details…" — the item dialog with pricing basis, measurement method and library. */
  onEdit: (node: BoqTreeNodeResponse) => void;
  onAddSection: (parent: BoqTreeNodeResponse) => void;
  /** "Add from library…" — the item dialog in add mode with the library picker. */
  onAddFromLibrary: (parent: BoqTreeNodeResponse) => void;
  onDelete: (node: BoqTreeNodeResponse) => void;
  onMove: (node: BoqTreeNodeResponse, direction: -1 | 1) => void;
  /** Hide the moves a node cannot make — the first sibling has no "Move up". */
  bounds: (node: BoqTreeNodeResponse) => { first: boolean; last: boolean };
  /** Persist one field; rejects on failure so the cell keeps the value for a retry. */
  onEditField: (node: BoqTreeNodeResponse, field: EditableField, value: string) => Promise<void>;
  /** Create a new line from the inline "+ Add item" / "+ Add section" row. */
  onCreate: (input: { parent: BoqTreeNodeResponse | null; kind: 'item' | 'section'; description: string }) => Promise<void>;
}

/** An inline line being typed but not yet created. */
export interface PendingLine {
  parentId: string | null;
  kind: 'item' | 'section';
}

/**
 * The BOQ grid.
 *
 * Two modes, one table:
 *
 *  - **Read** (no `commands`): a `role="grid"` with one roving tab stop and arrow-key navigation;
 *    Enter opens the line's details.
 *  - **Edit** (a draft the reader may change): boxed fields at rest — description, unit, quantity,
 *    rate — each saving itself on blur/Enter. Tab moves field to field, so the table drops the
 *    grid role and the roving focus (they would fight the inputs). Every open section that takes
 *    items ends with "+ Add item to {code}", which inserts a focused line; "+ Add section" sits
 *    under the table.
 *
 * Below 640px the unit, quantity and rate columns go; the line reads "180 m³ × $6.50" under its
 * description, and tapping it opens the item dialog — a phone is no place for a four-field row.
 *
 * Money follows the server's visibility tiers: without `canViewCommercials` the rate and amount
 * columns and the total are not drawn at all. The server withholds the figures too — the BOQ
 * controller nulls rates and amounts on the tree for a caller without the cost tier (ADR-029 §8
 * A-2) — so hiding the columns is presentation, not the protection.
 */
export function BoqGrid({
  rows,
  currency,
  totalAmount,
  sectionTotals,
  isFiltered,
  canViewCommercials,
  committed = false,
  showSource,
  highlighted = new Set(),
  collapsed,
  onToggle,
  onSelect,
  onPinnedCellEdit,
  commands,
  pending = null,
  onPendingChange,
  units,
  emptyMessage,
  footer = true,
}: {
  rows: BoqRow[];
  currency: string;
  totalAmount: string | null;
  /** Section id → rolled-up subtotal (decimal string, or null when unpriced). */
  sectionTotals: ReadonlyMap<string, string | null>;
  isFiltered: boolean;
  canViewCommercials: boolean;
  /** Legacy COMMITTED versions: value cells are pinned and open the who-pays decision. */
  committed?: boolean;
  showSource: boolean;
  highlighted?: ReadonlySet<string>;
  collapsed: ReadonlySet<string>;
  onToggle: (nodeId: string) => void;
  onSelect: (node: BoqTreeNodeResponse) => void;
  onPinnedCellEdit?: () => void;
  /** Present only on an editable draft. Its presence switches the grid to edit mode. */
  commands: BoqRowCommands | null;
  pending?: PendingLine | null;
  onPendingChange?: (next: PendingLine | null) => void;
  /** The unit registry for the unit cell's picker; undefined while unavailable. */
  units?: readonly UnitOfMeasureOption[] | undefined;
  emptyMessage: string;
  /** The BOQ-total footer row. Off for the import preview. */
  footer?: boolean;
}) {
  const t = useTranslations('platform.boq.grid');
  const locale = useLocale() as 'en' | 'ar';
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const editing = commands !== null;

  // Read mode: one row holds the tab stop, arrows move between rows.
  const [focusIndex, setFocusIndex] = useState(0);
  const activeIndex = clamp(focusIndex, rows.length);

  const entries: GridEntry[] =
    editing && !isFiltered ? withAddRows(rows) : rows.map((row) => ({ type: 'node', row }));

  // code · description · unit · quantity · [rate · amount] · [source] · actions
  const columnCount = 5 + (canViewCommercials ? 2 : 0) + (showSource ? 1 : 0);

  const focusRow = (index: number) => {
    setFocusIndex(index);
    bodyRef.current?.querySelectorAll<HTMLTableRowElement>('tr[data-node]')[index]?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTableSectionElement>) => {
    if (editing) return;
    if (event.target !== event.currentTarget && !(event.target as HTMLElement).matches('tr')) return;
    if (!isNavigationKey(event.key)) return;
    const intent = resolveKeyIntent(event.key, activeIndex, rows, false);
    if (!intent) return;
    event.preventDefault();
    if (intent.type === 'focus') focusRow(intent.index);
    else if (intent.type === 'toggle') onToggle(intent.nodeId);
    else if (intent.type === 'open') onSelect(rows[intent.index]!.node);
  };

  const pendingRow = (parent: BoqTreeNodeResponse | null, depth: number) => (
    <PendingLineRow
      key={`pending-${parent?.id ?? 'root'}`}
      kind={pending!.kind}
      depth={depth}
      parent={parent}
      columnCount={columnCount}
      onCancel={() => onPendingChange?.(null)}
      onCreate={async (description) => {
        await commands!.onCreate({ parent, kind: pending!.kind, description });
        onPendingChange?.(null);
      }}
    />
  );

  // A new sub-section is typed in place after the last line under its parent.
  let pendingSectionAfter = -1;
  let pendingSectionParent: BoqTreeNodeResponse | null = null;
  let pendingSectionDepth = 0;
  if (pending?.kind === 'section' && pending.parentId) {
    const start = entries.findIndex((entry) => entry.type === 'node' && entry.row.node.id === pending.parentId);
    if (start >= 0) {
      const parentRow = (entries[start] as Extract<GridEntry, { type: 'node' }>).row;
      pendingSectionParent = parentRow.node;
      pendingSectionDepth = parentRow.depth + 1;
      let end = start;
      for (let i = start + 1; i < entries.length; i += 1) {
        const entry = entries[i]!;
        const depth = entry.type === 'node' ? entry.row.depth : entry.depth - 1;
        if (depth <= parentRow.depth) break;
        end = i;
      }
      pendingSectionAfter = end;
    }
  }

  let nodeIndex = -1;

  const renderEntry = (entry: GridEntry): React.ReactNode => {
                if (entry.type === 'add') {
                  if (pending?.kind === 'item' && pending.parentId === entry.parent.id) {
                    return pendingRow(entry.parent, entry.depth);
                  }
                  return (
                    <AddLineRow
                      key={`add-${entry.parent.id}`}
                      label={t('addItemTo', { code: entry.parent.code })}
                      depth={entry.depth}
                      columnCount={columnCount}
                      onAdd={() => onPendingChange?.({ parentId: entry.parent.id, kind: 'item' })}
                    />
                  );
                }
                nodeIndex += 1;
                const index = nodeIndex;
                const { row } = entry;
                return (
                  <GridRow
                    key={row.node.id}
                    row={row}
                    currency={currency}
                    locale={locale}
                    canViewCommercials={canViewCommercials}
                    committed={committed}
                    showSource={showSource}
                    sectionTotal={row.node.isLeaf ? undefined : (sectionTotals.get(row.node.id) ?? null)}
                    highlighted={highlighted.has(row.node.id)}
                    collapsed={collapsed.has(row.node.id)}
                    tabbable={!editing && index === activeIndex}
                    onFocus={() => setFocusIndex(index)}
                    onToggle={onToggle}
                    onSelect={onSelect}
                    onPinnedCellEdit={onPinnedCellEdit}
                    commands={commands}
                    units={units}
                    onAddItemInline={() => {
                      if (collapsed.has(row.node.id)) onToggle(row.node.id);
                      onPendingChange?.({ parentId: row.node.id, kind: 'item' });
                    }}
                  />
                );
  };

  return (
    <div className="overflow-hidden rounded-panel border border-border bg-surface">
      <TableScroll className="rounded-none border-0">
        <Table role={editing ? undefined : 'grid'} aria-label={t('tableLabel')}>
          <TableHeader className="sticky top-0 z-10">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-24 whitespace-nowrap">{t('code')}</TableHead>
              <TableHead className="w-full sm:min-w-56">{t('description')}</TableHead>
              <TableHead className="whitespace-nowrap max-sm:hidden">{t('unit')}</TableHead>
              <TableHead numeric className="whitespace-nowrap max-sm:hidden">
                {t('quantity')}
              </TableHead>
              {canViewCommercials ? (
                <>
                  <TableHead numeric className="whitespace-nowrap max-sm:hidden">
                    {t('rate', { currency })}
                  </TableHead>
                  <TableHead numeric className="whitespace-nowrap">
                    {t('amount', { currency })}
                  </TableHead>
                </>
              ) : null}
              {showSource ? <TableHead className="whitespace-nowrap">{t('source')}</TableHead> : null}
              <TableHead className="w-12">
                <span className="sr-only">{t('actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>

          <TableBody ref={bodyRef} onKeyDown={handleKeyDown}>
            {entries.length === 0 && !pending ? (
              <TableEmpty colSpan={columnCount}>{emptyMessage}</TableEmpty>
            ) : (
              entries.flatMap((entry, entryIndex) => {
                const rendered = renderEntry(entry);
                return entryIndex === pendingSectionAfter && pendingSectionParent
                  ? [rendered, pendingRow(pendingSectionParent, pendingSectionDepth)]
                  : [rendered];
              })
            )}
            {pending && pending.parentId === null ? pendingRow(null, 0) : null}
          </TableBody>

          {footer && canViewCommercials ? (
            <tfoot className="border-t border-border bg-surface-subtle">
              <TableRow className="hover:bg-transparent">
                <TableCell />
                <TableCell className="text-end font-semibold text-foreground">{t('boqTotal')}</TableCell>
                <TableCell className="max-sm:hidden" />
                <TableCell className="max-sm:hidden" />
                <TableCell className="max-sm:hidden" />
                <TableCell numeric className="font-semibold text-foreground">
                  <LtrValue>{formatMoney(totalAmount, currency, locale) ?? '—'}</LtrValue>
                </TableCell>
                {showSource ? <TableCell /> : null}
                <TableCell />
              </TableRow>
            </tfoot>
          ) : null}
        </Table>
      </TableScroll>
    </div>
  );
}

function indentStyle(depth: number): React.CSSProperties {
  return { paddingInlineStart: `${depth * 1.25}rem` };
}

/**
 * A lump-sum line reads and behaves as one whatever quantity it was stored with — an imported
 * `5 × 100` is still one fixed amount, not five of something. Its quantity is not editable here.
 */
function isLumpSum(node: BoqTreeNodeResponse): boolean {
  return node.pricingBasis === 'LUMP_SUM';
}

function GridRow({
  row,
  currency,
  locale,
  canViewCommercials,
  committed,
  showSource,
  sectionTotal,
  highlighted,
  collapsed,
  tabbable,
  onFocus,
  onToggle,
  onSelect,
  onPinnedCellEdit,
  commands,
  units,
  onAddItemInline,
}: {
  row: BoqRow;
  currency: string;
  locale: 'en' | 'ar';
  canViewCommercials: boolean;
  committed: boolean;
  showSource: boolean;
  sectionTotal?: string | null;
  highlighted: boolean;
  collapsed: boolean;
  tabbable: boolean;
  onFocus: () => void;
  onToggle: (nodeId: string) => void;
  onSelect: (node: BoqTreeNodeResponse) => void;
  onPinnedCellEdit?: () => void;
  commands: BoqRowCommands | null;
  units: readonly UnitOfMeasureOption[] | undefined;
  onAddItemInline: () => void;
}) {
  const t = useTranslations('platform.boq.grid');
  const { node, depth, hasChildren } = row;
  const editing = commands !== null;
  const pinned = committed && node.isLeaf;
  const editValues = editing && !pinned;
  const lumpSum = node.isLeaf && isLumpSum(node);
  const unpriced = node.isLeaf && node.unitRate === null;
  const saveFailed = t('saveFailed');

  const commit = (field: EditableField) => (value: string) => commands!.onEditField(node, field, value);

  const quantityText = node.quantity ? formatNumber(Number(node.quantity), locale, 3) : null;
  // A lump sum's "rate" column carries its amount (an imported 5 × 100 reads 500, not 100).
  const rateValue = lumpSum ? lumpSumOf(node.quantity, node.unitRate) || null : node.unitRate;
  const rateText = rateValue ? formatMoney(rateValue, currency, locale) : null;
  // The phone line: "180 m³ × $6.50" — what the hidden columns would have said.
  const mobileSummary = node.isLeaf
    ? [
        lumpSum ? t('lumpSum') : quantityText ? `${quantityText}${node.unit ? ` ${node.unit}` : ''}` : null,
        canViewCommercials ? (rateText ?? t('noRate')) : null,
      ]
        .filter(Boolean)
        .join(' × ')
    : '';

  return (
    <TableRow
      data-node=""
      onClick={() => {
        // In edit mode the fields are the interaction; only a phone (no fields) opens the sheet.
        if (editing && !window.matchMedia('(max-width: 639px)').matches) return;
        onSelect(node);
      }}
      onFocus={editing ? undefined : onFocus}
      tabIndex={editing ? undefined : tabbable ? 0 : -1}
      aria-expanded={!editing && hasChildren ? !collapsed : undefined}
      className={cn(
        editing ? 'max-sm:cursor-pointer' : 'cursor-pointer',
        'align-top focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-brand-primary',
        !node.isLeaf && 'bg-surface-subtle font-semibold',
        highlighted && 'bg-warning-subtle',
        !node.isActive && 'opacity-60',
      )}
    >
      <TableCell className="whitespace-nowrap">
        <div className="flex min-h-8 items-center gap-1">
          {!node.isLeaf ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onToggle(node.id);
              }}
              disabled={!hasChildren}
              aria-expanded={hasChildren ? !collapsed : undefined}
              aria-label={t(collapsed ? 'expandSection' : 'collapseSection', { code: node.code })}
              className={cn(
                // 28px glyph box, 44px hit area (the ::after extends it) — the row stays dense.
                'relative flex size-7 shrink-0 items-center justify-center rounded-control text-muted-foreground transition-colors after:absolute after:-inset-2 after:content-[""] hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:shadow-ring',
                !hasChildren && 'invisible',
              )}
            >
              <ChevronRight
                size={14}
                className={cn('transition-transform', !collapsed && 'rotate-90')}
                aria-hidden="true"
              />
            </button>
          ) : (
            <span className="size-7 shrink-0" aria-hidden="true" />
          )}
          <LtrValue className={cn('text-caption tabular-nums', node.isLeaf ? 'text-muted-foreground' : 'text-foreground')}>
            {node.code}
          </LtrValue>
          <span className="sr-only">{node.isLeaf ? t('typeItem') : t('typeSection')}</span>
        </div>
      </TableCell>

      <TableCell>
        <div style={indentStyle(depth)} className="min-w-0">
          {editing ? (
            <>
              <CellEditor
                className="max-sm:hidden"
                value={node.description}
                kind={node.isLeaf ? 'textarea' : 'text'}
                ariaLabel={t(node.isLeaf ? 'editDescription' : 'editSectionName', { code: node.code })}
                errorText={saveFailed}
                onCommit={commit('description')}
              />
              <p className="text-body-sm sm:hidden">{node.description}</p>
            </>
          ) : (
            <p className={cn('text-body-sm', !node.isLeaf && 'text-foreground')}>{node.description}</p>
          )}
          {mobileSummary ? (
            <p className="mt-0.5 text-caption tabular-nums text-muted-foreground sm:hidden">{mobileSummary}</p>
          ) : null}
        </div>
      </TableCell>

      <TableCell className="max-sm:hidden">
        {!node.isLeaf ? null : lumpSum ? (
          <span className="text-muted-foreground">—</span>
        ) : editValues ? (
          <UnitCellEditor
            className="w-24"
            value={node.unit}
            units={units}
            ariaLabel={t('editUnit', { code: node.code })}
            errorText={saveFailed}
            onCommit={commit('unit')}
          />
        ) : (
          <span className="text-body-sm">{node.unit ?? '—'}</span>
        )}
      </TableCell>

      <TableCell numeric className="max-sm:hidden">
        {!node.isLeaf ? null : lumpSum ? (
          <span className="text-muted-foreground">{t('lumpSum')}</span>
        ) : pinned ? (
          <PinnedCell value={quantityText} ariaLabel={t('editQuantity', { code: node.code })} onEdit={onPinnedCellEdit} />
        ) : editValues ? (
          <CellEditor
            className="ms-auto w-28"
            value={node.quantity}
            kind="quantity"
            ariaLabel={t('editQuantity', { code: node.code })}
            errorText={saveFailed}
            onCommit={commit('quantity')}
          />
        ) : (
          <LtrValue>{quantityText ?? '—'}</LtrValue>
        )}
      </TableCell>

      {canViewCommercials ? (
        <>
          <TableCell numeric className="max-sm:hidden">
            {!node.isLeaf ? null : pinned ? (
              <PinnedCell value={rateText} ariaLabel={t('editRate', { code: node.code })} onEdit={onPinnedCellEdit} />
            ) : editValues ? (
              <CellEditor
                className="ms-auto w-32"
                value={rateValue}
                kind="rate"
                attention={unpriced}
                currencySymbol={currencySymbol(currency)}
                ariaLabel={t('editRate', { code: node.code })}
                placeholder={t('noRate')}
                errorText={saveFailed}
                onCommit={commit(lumpSum ? 'lumpSumAmount' : 'unitRate')}
              />
            ) : unpriced ? (
              <span className="text-caption font-medium text-warning">{t('noRate')}</span>
            ) : (
              <LtrValue>{rateText}</LtrValue>
            )}
          </TableCell>
          <TableCell numeric className={cn('whitespace-nowrap', !node.isLeaf && 'font-semibold')}>
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

      {showSource ? (
        <TableCell>
          <SourceCell node={node} />
        </TableCell>
      ) : null}

      <TableCell className="w-12">
        {commands ? <RowMenu node={node} commands={commands} onAddItemInline={onAddItemInline} /> : null}
      </TableCell>
    </TableRow>
  );
}

/** "+ Add item to 1.3" — the end of an open section that takes items. */
function AddLineRow({
  label,
  depth,
  columnCount,
  onAdd,
}: {
  label: string;
  depth: number;
  columnCount: number;
  onAdd: () => void;
}) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell className="max-sm:hidden" />
      <TableCell colSpan={columnCount - 1} className="py-1.5">
        <div style={indentStyle(depth)}>
          <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-brand-primary" onClick={onAdd}>
            <Plus size={14} aria-hidden="true" />
            {label}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

/**
 * A line being typed. It exists only here until its description is committed, because a node
 * without a description is not valid on the server; leaving it empty (blur, Escape) abandons it.
 */
function PendingLineRow({
  kind,
  depth,
  parent,
  columnCount,
  onCreate,
  onCancel,
}: {
  kind: 'item' | 'section';
  depth: number;
  parent: BoqTreeNodeResponse | null;
  columnCount: number;
  onCreate: (description: string) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useTranslations('platform.boq.grid');
  return (
    <TableRow className={cn('hover:bg-transparent', kind === 'section' && 'bg-surface-subtle')}>
      <TableCell className="text-caption text-muted-foreground">
        <span className="ps-8">{t('newCode')}</span>
      </TableCell>
      <TableCell colSpan={columnCount - 1}>
        <div style={indentStyle(depth)} className="max-w-2xl">
          <CellEditor
            autoFocus
            value={null}
            kind={kind === 'item' ? 'textarea' : 'text'}
            placeholder={t(kind === 'item' ? 'newItemPlaceholder' : 'newSectionPlaceholder')}
            ariaLabel={
              kind === 'item'
                ? t('newItemIn', { code: parent?.code ?? '' })
                : parent
                  ? t('newSubsectionIn', { code: parent.code })
                  : t('newSection')
            }
            errorText={t('createFailed')}
            onCommit={onCreate}
            onEmptyCommit={onCancel}
          />
        </div>
      </TableCell>
    </TableRow>
  );
}

function PinnedCell({
  value,
  ariaLabel,
  onEdit,
}: {
  value: string | null;
  ariaLabel: string;
  onEdit?: () => void;
}) {
  const t = useTranslations('platform.boq.mode');
  const content = <LtrValue>{value ?? '—'}</LtrValue>;
  if (!onEdit) {
    return (
      <span className="inline-flex items-center justify-end gap-1">
        {content}
        <Lock size={11} aria-hidden="true" className="text-muted-foreground" />
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onEdit();
      }}
      aria-label={`${ariaLabel} — ${t('pinnedCell')}`}
      title={t('pinnedCell')}
      className="inline-flex items-center justify-end gap-1 rounded-control px-1 py-0.5 hover:bg-surface-hover focus-visible:outline-none focus-visible:shadow-ring"
    >
      {content}
      <Lock size={11} aria-hidden="true" className="text-muted-foreground" />
    </button>
  );
}

function SourceCell({ node }: { node: BoqTreeNodeResponse }) {
  const t = useTranslations('platform.boq.grid');
  if (node.sourceType === 'VARIATION') {
    return (
      <Badge tone="neutral" className="gap-1">
        <Diamond size={10} aria-hidden="true" />
        {node.sourceChangeOrderId ? t('sourceVariationRef', { ref: node.sourceChangeOrderId }) : t('sourceVariation')}
      </Badge>
    );
  }
  if (node.commercialTreatment === 'ABSORBED') {
    return (
      <Badge tone="neutral" className="gap-1">
        <CircleDollarSign size={10} aria-hidden="true" />
        {t('sourceAbsorbed')}
      </Badge>
    );
  }
  if (node.commercialTreatment === 'SEPARATE_CHARGE') {
    return (
      <Badge tone="neutral" className="gap-1">
        <Receipt size={10} aria-hidden="true" />
        {t('sourceSeparate')}
      </Badge>
    );
  }
  return <span className="text-caption text-muted-foreground">—</span>;
}

/**
 * One menu per row. Only the commands this node can take are listed — a section that holds
 * sub-sections is not offered "Add item" (the server forbids mixing), the first sibling has no
 * "Move up", and a section with lines under it has no Delete (the server refuses it; its lines go
 * first).
 */
function RowMenu({
  node,
  commands,
  onAddItemInline,
}: {
  node: BoqTreeNodeResponse;
  commands: BoqRowCommands;
  onAddItemInline: () => void;
}) {
  const t = useTranslations('platform.boq.grid');
  const { first, last } = commands.bounds(node);
  const canDelete = node.isLeaf || countDescendants(node) === 0;

  return (
    <div onClick={(event) => event.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t('rowMenu', { code: node.code })}>
            <MoreHorizontal size={16} aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {node.isLeaf ? (
            <DropdownMenuItem onSelect={() => commands.onEdit(node)}>{t('editDetails')}</DropdownMenuItem>
          ) : (
            <>
              {acceptsItems(node) ? (
                <>
                  <DropdownMenuItem onSelect={onAddItemInline}>{t('addItem')}</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => commands.onAddFromLibrary(node)}>
                    {t('addFromLibrary')}
                  </DropdownMenuItem>
                </>
              ) : null}
              {acceptsSections(node) ? (
                <DropdownMenuItem onSelect={() => commands.onAddSection(node)}>{t('addSubsection')}</DropdownMenuItem>
              ) : null}
            </>
          )}
          {!first || !last ? <DropdownMenuSeparator /> : null}
          {!first ? (
            <DropdownMenuItem onSelect={() => commands.onMove(node, -1)}>{t('moveUp')}</DropdownMenuItem>
          ) : null}
          {!last ? (
            <DropdownMenuItem onSelect={() => commands.onMove(node, 1)}>{t('moveDown')}</DropdownMenuItem>
          ) : null}
          {canDelete ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => commands.onDelete(node)}>
                {node.isLeaf ? t('delete') : t('deleteSection')}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
