import * as React from 'react';
import { SlidersHorizontal, X } from 'lucide-react';

import { cn } from '../lib/utils';
import { Button } from './button';
import { DatePicker } from './date-picker';
import { Label } from './label';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { Select } from './select';

export type FilterValues = Record<string, string>;

interface FilterFieldBase {
  key: string;
  label: string;
}

export interface SelectListFilterField extends FilterFieldBase {
  type: 'select';
  options: Array<{ value: string; label: string }>;
  /** Label of the "no filter" option. */
  anyLabel?: string;
}

export interface DateListFilterField extends FilterFieldBase {
  type: 'date';
}

export type ListFilterField = SelectListFilterField | DateListFilterField;

export interface FilterPanelLabels {
  trigger: string;
  title: string;
  apply: string;
  clear: string;
  any: string;
}

const DEFAULT_LABELS: FilterPanelLabels = {
  trigger: 'Filter',
  title: 'Filters',
  apply: 'Apply',
  clear: 'Clear',
  any: 'Any',
};

export interface FilterPanelProps {
  fields: ListFilterField[];
  /** The applied filters. `''` or a missing key means "any". */
  value: FilterValues;
  /** Called only on Apply (or Clear) — the panel edits a draft until then. */
  onApply: (next: FilterValues) => void;
  labels?: Partial<FilterPanelLabels>;
}

function countApplied(value: FilterValues): number {
  return Object.values(value).filter(Boolean).length;
}

/**
 * The list filter (ADR-035): a Filter button that opens a panel of fields in a two-column grid.
 * The panel edits a draft — nothing on the list changes until Apply, so a reader choosing three
 * filters does not watch the table reload three times. Escape closes it and returns focus to
 * the button. The applied filters are shown outside the panel as `FilterChips`.
 */
export function FilterPanel({ fields, value, onApply, labels: labelOverrides }: FilterPanelProps) {
  const labels = { ...DEFAULT_LABELS, ...labelOverrides };
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<FilterValues>(value);
  const baseId = React.useId();
  const applied = countApplied(value);

  // Re-seed the draft from the applied filters every time the panel opens.
  const onOpenChange = (next: boolean) => {
    if (next) setDraft(value);
    setOpen(next);
  };

  const set = (key: string, next: string) => setDraft((d) => ({ ...d, [key]: next }));

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="gap-2">
          <SlidersHorizontal size={16} aria-hidden="true" />
          {labels.trigger}
          {applied > 0 ? (
            <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-brand-ink px-1.5 text-caption font-semibold text-brand-on-primary">
              {applied}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(34rem,calc(100vw-2rem))] p-0">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onApply(draft);
            setOpen(false);
          }}
        >
          <p className="border-b border-border px-4 py-3 text-body-sm font-semibold text-foreground">
            {labels.title}
          </p>
          <div className="grid gap-4 px-4 py-4 sm:grid-cols-2">
            {fields.map((field) => {
              const id = `${baseId}-${field.key}`;
              return (
                <div key={field.key} className="min-w-0 space-y-1.5">
                  <Label htmlFor={id}>{field.label}</Label>
                  {field.type === 'select' ? (
                    <Select
                      id={id}
                      value={draft[field.key] ?? ''}
                      onChange={(next) => set(field.key, next)}
                      className="w-full"
                    >
                      <option value="">{field.anyLabel ?? labels.any}</option>
                      {field.options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <DatePicker
                      id={id}
                      value={draft[field.key] ?? ''}
                      onChange={(next) => set(field.key, next)}
                      clearLabel={labels.clear}
                      className="w-full"
                    />
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setDraft({});
                onApply({});
                setOpen(false);
              }}
            >
              {labels.clear}
            </Button>
            <Button type="submit">{labels.apply}</Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

export interface FilterChip {
  key: string;
  /** The field — "Approval status". */
  label: string;
  /** The applied value, already translated — "Approved". */
  value: string;
}

export interface FilterChipsProps {
  chips: FilterChip[];
  onRemove: (key: string) => void;
  onClearAll: () => void;
  labels?: { clearAll?: string; remove?: (chip: FilterChip) => string };
  className?: string;
}

/**
 * The filters in force, one removable chip each — applied filters only, never the draft.
 * Renders nothing when no filter is applied.
 */
export function FilterChips({ chips, onRemove, onClearAll, labels, className }: FilterChipsProps) {
  if (chips.length === 0) return null;
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex min-h-7 items-center gap-1 rounded-full border border-border bg-surface px-3 text-caption text-muted-foreground"
        >
          {chip.label}:
          <span className="font-semibold text-foreground">{chip.value}</span>
          <button
            type="button"
            onClick={() => onRemove(chip.key)}
            aria-label={labels?.remove?.(chip) ?? `Remove ${chip.label}`}
            className="-me-1.5 ms-0.5 inline-flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"
          >
            <X size={12} aria-hidden="true" />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="min-h-7 rounded-control px-1 text-caption font-medium text-brand-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"
      >
        {labels?.clearAll ?? 'Clear all'}
      </button>
    </div>
  );
}
