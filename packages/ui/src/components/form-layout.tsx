'use client';

import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { cn } from '../lib/utils';

// ─── Record create header ─────────────────────────────────────────────────────

/**
 * The top of a master-data create form (ADR-037): the record's icon tile beside its name field,
 * set large, because the name is what the record will be known by. Pass a `FormField` holding
 * an `Input` with `className={RECORD_NAME_INPUT}`.
 */
export function RecordCreateHeader({
  icon,
  children,
  className,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start gap-4', className)}>
      <span
        aria-hidden="true"
        className="mt-7 flex size-12 shrink-0 items-center justify-center rounded-panel border border-border bg-surface-subtle text-muted-foreground"
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** The large name input inside `RecordCreateHeader`. */
export const RECORD_NAME_INPUT = 'h-14 text-h2 font-semibold';

// ─── Form action bar ──────────────────────────────────────────────────────────

export type FormSaveState = 'new' | 'dirty' | 'clean';

export interface FormActionBarProps {
  /** Back link to the list — a `Link`, rendered by the caller. */
  back?: React.ReactNode;
  /** The save button: "Save client", "Save draft". */
  save: React.ReactNode;
  /** Discard: a ghost button or link. */
  discard?: React.ReactNode;
  /** Drives the status dot: nothing entered, unsaved changes, or saved. */
  saveState: FormSaveState;
  /** Labels for the three states, already translated. */
  saveStateLabels: Record<FormSaveState, string>;
  /** A new document's lifecycle — a `LifecycleStepper` at its first step. */
  lifecycle?: React.ReactNode;
  className?: string;
}

/**
 * The sticky bar on a create or edit form (ADR-037): back, Save, Discard, and whether there is
 * anything unsaved. A new document also shows its lifecycle, so the reader knows Save makes a
 * Draft and that submitting, approving and posting come after, as separate commands.
 */
export function FormActionBar({
  back,
  save,
  discard,
  saveState,
  saveStateLabels,
  lifecycle,
  className,
}: FormActionBarProps) {
  return (
    <div
      className={cn(
        'sticky top-14 z-20 -mx-4 mb-6 flex flex-wrap items-center gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:mx-0 sm:rounded-panel sm:border sm:bg-surface',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {back}
        {save}
        {discard}
      </div>
      <div className="flex w-full flex-wrap items-center gap-4 sm:w-auto">
        <span className="inline-flex items-center gap-1.5 text-caption text-muted-foreground" role="status">
          <span
            aria-hidden="true"
            className={cn(
              'size-1.5 rounded-full',
              saveState === 'dirty' ? 'bg-warning' : saveState === 'clean' ? 'bg-success' : 'border border-muted-foreground',
            )}
          />
          {saveStateLabels[saveState]}
        </span>
        {lifecycle}
      </div>
    </div>
  );
}

// ─── Form section ─────────────────────────────────────────────────────────────

/**
 * A titled group of fields under a hairline — "Details", "Contact", "Billing" — with a one-line
 * purpose. Fields sit in two columns from `sm`.
 */
export function FormGroup({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const id = React.useId();
  return (
    <section aria-labelledby={id} className={cn('space-y-4', className)}>
      <div className="border-b border-border pb-2">
        <h2 id={id} className="text-body font-semibold text-foreground">
          {title}
        </h2>
        {description ? <p className="text-caption text-muted-foreground">{description}</p> : null}
      </div>
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

// ─── Line items editor ────────────────────────────────────────────────────────

export interface LineColumn<T> {
  key: string;
  header: string;
  required?: boolean;
  /** CSS grid track for the desktop row — `'minmax(0,2fr)'`, `'7rem'`. */
  width: string;
  align?: 'start' | 'end';
  /** The id of the control in this cell, so the phone label can point at it. */
  controlId?: (index: number) => string;
  /** The editor (or read-only value) for this cell. */
  cell: (row: T, index: number) => React.ReactNode;
  /** Hide from the phone card — e.g. a derived figure already in the card title. */
  hideOnCard?: boolean;
}

export interface LineNote {
  tone: 'warning' | 'danger';
  text: string;
}

export interface LineItemsEditorProps<T> {
  /** Accessible name — "Invoice lines". */
  label: string;
  rows: T[];
  rowKey: (row: T, index: number) => string;
  columns: LineColumn<T>[];
  /** Per-cell errors for a row, keyed by column. Shown under that cell. */
  errors?: (index: number) => Partial<Record<string, string>> | undefined;
  /** A note that spans the row — "Billing 20 bag more than received on GRN-2026-0154". */
  note?: (row: T, index: number) => LineNote | null;
  /** The phone card's title — "Line 1 — Site mobilisation". */
  cardTitle: (row: T, index: number) => string;
  onAdd?: () => void;
  addLabel?: string;
  onRemove?: (index: number) => void;
  removeLabel?: (index: number) => string;
  /** Lines that come from a source document (a certified IPC, a billing milestone). */
  readOnly?: boolean;
  className?: string;
}

/**
 * The one line-items editor (ADR-037), for invoices, bills, purchase orders and requests.
 *
 * Each line is a single set of controls laid out by CSS: a table row from `md`, a stacked card
 * below it with every cell labelled. It is deliberately not two renderings of the same line —
 * that would put every input in the DOM twice, with duplicate ids and a form registering each
 * field twice. Columns are configuration, so a PO bill (ordered / received / billed) and a
 * direct expense (description / account / qty / price) are the same component.
 */
export function LineItemsEditor<T>({
  label,
  rows,
  rowKey,
  columns,
  errors,
  note,
  cardTitle,
  onAdd,
  addLabel = 'Add a line',
  onRemove,
  removeLabel = (i) => `Remove line ${i + 1}`,
  readOnly = false,
  className,
}: LineItemsEditorProps<T>) {
  const removable = !readOnly && Boolean(onRemove);
  const tracks = ['2rem', ...columns.map((c) => c.width), removable ? '2.5rem' : null]
    .filter(Boolean)
    .join(' ');
  const gridStyle = { '--line-tracks': tracks } as React.CSSProperties;
  const rowGrid = 'md:grid md:grid-cols-(--line-tracks) md:items-start md:gap-3';

  return (
    <div className={cn('space-y-3', className)}>
      <div role="table" aria-label={label} style={gridStyle} className="md:rounded-panel md:border md:border-border md:bg-surface">
        {/* Header — desktop only; on phones every cell carries its own label. */}
        <div role="rowgroup" className="hidden md:block">
          <div
            role="row"
            className={cn(rowGrid, 'border-b border-border bg-surface-subtle px-3 py-2 text-caption font-semibold text-muted-foreground')}
          >
            <span role="columnheader">#</span>
            {columns.map((col) => (
              <span key={col.key} role="columnheader" className={cn(col.align === 'end' && 'text-end')}>
                {col.header}
                {col.required && !readOnly ? (
                  <span className="ms-0.5 text-danger" aria-hidden="true">
                    *
                  </span>
                ) : null}
              </span>
            ))}
            {removable ? <span role="columnheader" className="sr-only">{removeLabel(0)}</span> : null}
          </div>
        </div>

        <div role="rowgroup" className="space-y-3 md:space-y-0 md:divide-y md:divide-border">
          {rows.map((row, index) => {
            const rowErrors = errors?.(index) ?? {};
            const rowNote = note?.(row, index) ?? null;
            return (
              <div
                key={rowKey(row, index)}
                role="row"
                className="rounded-panel border border-border bg-surface p-3 md:rounded-none md:border-0 md:bg-transparent md:px-3 md:py-2"
              >
                {/* Phone: the card title and its remove button. */}
                <div className="mb-3 flex items-center justify-between gap-2 md:hidden">
                  <p className="min-w-0 truncate text-body-sm font-semibold text-foreground">{cardTitle(row, index)}</p>
                  {removable ? (
                    <RemoveButton label={removeLabel(index)} onClick={() => onRemove!(index)} />
                  ) : null}
                </div>

                <div className={cn('grid grid-cols-2 gap-3', rowGrid)}>
                  <span role="cell" className="hidden pt-2 text-caption text-muted-foreground md:block">
                    {index + 1}
                  </span>
                  {columns.map((col) => {
                    const error = rowErrors[col.key];
                    const controlId = col.controlId?.(index);
                    return (
                      <div
                        key={col.key}
                        role="cell"
                        className={cn(
                          'min-w-0',
                          col.hideOnCard && 'hidden md:block',
                          // Wide columns take the full card width on phones.
                          col.width.includes('fr') && 'col-span-2 md:col-span-1',
                          col.align === 'end' && 'md:text-end',
                        )}
                      >
                        <label
                          htmlFor={controlId}
                          className="mb-1 block text-caption font-medium text-muted-foreground md:sr-only"
                        >
                          {col.header}
                          {col.required && !readOnly ? (
                            <span className="ms-0.5 text-danger" aria-hidden="true">
                              *
                            </span>
                          ) : null}
                        </label>
                        <div className={cn(readOnly && 'py-2 text-body-sm')}>{col.cell(row, index)}</div>
                        {error ? (
                          <p className="mt-1 text-caption font-medium text-danger" role="alert">
                            {error}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                  {removable ? (
                    <div role="cell" className="hidden justify-end pt-1 md:flex">
                      <RemoveButton label={removeLabel(index)} onClick={() => onRemove!(index)} />
                    </div>
                  ) : null}
                </div>

                {rowNote ? (
                  <p
                    className={cn(
                      'mt-2 text-caption font-medium md:ps-11',
                      rowNote.tone === 'warning' ? 'text-warning' : 'text-danger',
                    )}
                  >
                    {rowNote.text}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {onAdd && !readOnly ? (
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-control px-2 text-body-sm font-medium text-brand-primary hover:underline focus-visible:outline-none focus-visible:shadow-ring"
        >
          <Plus size={16} aria-hidden="true" />
          {addLabel}
        </button>
      ) : null}
    </div>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="inline-flex size-9 items-center justify-center rounded-control text-muted-foreground hover:bg-danger-subtle hover:text-danger focus-visible:outline-none focus-visible:shadow-ring"
    >
      <Trash2 size={16} aria-hidden="true" />
    </button>
  );
}
