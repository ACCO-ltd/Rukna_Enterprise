'use client';

import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';

import { cn } from '../lib/utils';
import { FormFieldContext } from './form-field';

/**
 * A single-choice field whose list this product actually owns.
 *
 * ─── Why this stopped being a native `<select>` ──────────────────────────────────
 *
 * The trigger was never the problem: it already carried `h-control`, `rounded-control`,
 * `border-border-strong` and the focus ring, like every other field. The **option list** was,
 * and no amount of CSS could reach it — a native `<select>` popup is drawn by the operating
 * system, outside the document. So on every form in the product the field looked like ours
 * until you opened it, and then looked like Windows: system blue, square corners, system font,
 * no idea the app had a dark theme.
 *
 * ─── Why the `<option>` children stayed ──────────────────────────────────────────
 *
 * Radix wants `SelectItem` elements. Taking them directly would have rewritten fifty-nine call
 * sites for no gain, so this walks its children and maps `<option>` to `SelectItem`. The JSX
 * at every call site is unchanged; only the `onChange` signature moved, because Radix reports
 * a value rather than an event and pretending otherwise would mean forging a synthetic
 * `event.target`.
 *
 * ─── The empty option ────────────────────────────────────────────────────────────
 *
 * Radix reserves `value=""` to mean "nothing is selected" and throws if an item uses it. Nearly
 * every select here opens with `<option value="">Choose…</option>`, which is both the
 * placeholder *and*, on an optional field, a value the user must be able to return to. So an
 * empty-valued option becomes the placeholder text and is re-offered as a real row under a
 * private sentinel, translated back to `''` on the way out. Callers keep writing `''` and never
 * see the sentinel.
 *
 * ─── Groups ──────────────────────────────────────────────────────────────────────
 *
 * `<optgroup>` is honoured because the chart-of-accounts form depends on it: thirty account
 * subtypes are unreadable as a flat list and are grouped by class. It maps to Radix's Group
 * and Label, so the grouping survives to assistive technology rather than becoming a styled
 * row that only looks like a heading.
 */

/** Private stand-in for the empty value. Never leaves this module. */
const EMPTY = '__erp_empty__';
/** Private value for the create row, intercepted before any caller sees it. */
const CREATE = '__erp_create__';

export interface SelectProps {
  id?: string;
  name?: string;
  /** `''` means nothing chosen. */
  value?: string;
  defaultValue?: string;
  /** Receives the chosen value, or `''` for the empty option. */
  onChange?: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  /** Overrides the text taken from the `value=""` option. */
  placeholder?: string;
  /**
   * A row pinned to the foot of the list — "Add a district", "Add a supplier".
   *
   * It belongs in the list rather than beside the field because it is read at the moment
   * someone has finished scanning the options and concluded theirs is missing, which is the
   * only moment it is wanted. Gate it on the permission the create endpoint enforces: a
   * control that only ever produces a 403 is worse than no control.
   */
  createAction?: { label: string; onSelect: () => void };
  /** `<option>` elements, optionally wrapped in `<optgroup label>`. */
  children: React.ReactNode;
  className?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
}

interface ParsedOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

interface ParsedGroup {
  label: React.ReactNode;
  options: ParsedOption[];
}

type ParsedEntry = ParsedOption | ParsedGroup;

const isGroup = (entry: ParsedEntry): entry is ParsedGroup => 'options' in entry;

function parseOptions(children: React.ReactNode): { entries: ParsedEntry[]; placeholder?: string } {
  const entries: ParsedEntry[] = [];
  let placeholder: string | undefined;

  const readOption = (child: React.ReactElement): ParsedOption => {
    const props = child.props as React.OptionHTMLAttributes<HTMLOptionElement> & {
      children?: React.ReactNode;
    };
    const value = String(props.value ?? '');
    if (value === '') {
      if (typeof props.children === 'string') placeholder = props.children;
      return { value: EMPTY, label: props.children, disabled: props.disabled };
    }
    return { value, label: props.children, disabled: props.disabled };
  };

  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;

    if (child.type === 'option') {
      entries.push(readOption(child));
      return;
    }

    if (child.type === 'optgroup') {
      const props = child.props as React.OptgroupHTMLAttributes<HTMLOptGroupElement> & {
        children?: React.ReactNode;
      };
      const options: ParsedOption[] = [];
      React.Children.forEach(props.children, (grandchild) => {
        if (React.isValidElement(grandchild) && grandchild.type === 'option') {
          options.push(readOption(grandchild));
        }
      });
      if (options.length > 0) entries.push({ label: props.label, options });
    }
  });

  return { entries, placeholder };
}

export function Select({
  id,
  name,
  value,
  defaultValue,
  onChange,
  disabled,
  required,
  placeholder,
  createAction,
  children,
  className,
  'aria-label': ariaLabel,
  'aria-describedby': describedByProp,
}: SelectProps) {
  const field = React.useContext(FormFieldContext);
  const { entries, placeholder: fromOption } = parseOptions(children);

  const ctxDescribedBy = field
    ? [field.hintId, field.errorId, field.successId].filter(Boolean).join(' ') || undefined
    : undefined;
  const describedBy = [describedByProp, ctxDescribedBy].filter(Boolean).join(' ') || undefined;

  const isInvalid = field?.hasError ? true : undefined;
  const isRequired = required ?? (field?.required ? true : undefined);


  const renderItem = (option: ParsedOption) => (
    <SelectPrimitive.Item
      key={option.value}
      value={option.value}
      disabled={option.disabled}
      // Radix does not put the value in the DOM. Tests used to drive these fields by
      // value through `selectOptions`; without this they would have to match on
      // display text, which is translated and often not unique in a list.
      data-value={option.value}
      className={cn(
        'relative flex min-h-control cursor-pointer select-none items-center gap-2 rounded-control px-3 py-2 text-body-sm outline-none',
        'data-[highlighted]:bg-surface-hover',
        'data-[state=checked]:bg-surface-selected data-[state=checked]:font-semibold',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      )}
    >
      <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="ms-auto text-brand-primary">
        <CheckGlyph />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );

  const toRadix = (v: string | undefined) => (v === '' ? EMPTY : v);
  const fromRadix = (v: string) => (v === EMPTY ? '' : v);

  return (
    <SelectPrimitive.Root
      name={name}
      value={toRadix(value)}
      defaultValue={toRadix(defaultValue)}
      onValueChange={(next) => {
        // The create row is a row so that arrow keys reach it like any other; it is not a
        // value, so it is intercepted here. The component is controlled, so the momentary
        // selection Radix makes is discarded on the next render.
        if (next === CREATE) {
          createAction?.onSelect();
          return;
        }
        onChange?.(fromRadix(next));
      }}
      disabled={disabled}
      required={isRequired}
    >
      <SelectPrimitive.Trigger
        id={id}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        aria-invalid={isInvalid}
        className={cn(
          'flex h-control w-full items-center justify-between gap-2 rounded-control border border-border-strong bg-surface px-3.5 py-2 text-start text-body-sm text-foreground shadow-e1',
          'transition-[border-color,box-shadow] duration-(--motion-enter) ease-brand',
          'hover:border-border-interactive focus:border-brand-primary focus:outline-none focus:shadow-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'data-[placeholder]:text-muted-foreground',
          isInvalid && 'border-danger focus:border-danger',
          field?.hasSuccess && !isInvalid && 'border-success',
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder ?? fromOption} />
        <SelectPrimitive.Icon asChild>
          <CaretGlyph />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          className={cn(
            'z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-panel border border-border bg-surface-elevated text-foreground shadow-e3',
            'motion-safe:animate-enter-fade',
          )}
        >
          <SelectPrimitive.ScrollUpButton className="flex h-6 items-center justify-center text-muted-foreground">
            <CaretGlyph className="rotate-180" />
          </SelectPrimitive.ScrollUpButton>

          <SelectPrimitive.Viewport className="p-1">
            {entries.map((entry, index) =>
              isGroup(entry) ? (
                <SelectPrimitive.Group key={`group-${index}`}>
                  <SelectPrimitive.Label className="px-3 pb-1 pt-2 text-micro font-semibold uppercase text-muted-foreground">
                    {entry.label}
                  </SelectPrimitive.Label>
                  {entry.options.map((option) => renderItem(option))}
                </SelectPrimitive.Group>
              ) : (
                renderItem(entry)
              ),
            )}

            {createAction ? (
              <>
                <SelectPrimitive.Separator className="my-1 h-px bg-border" />
                <SelectPrimitive.Item
                  value={CREATE}
                  className="flex min-h-control cursor-pointer select-none items-center gap-2 rounded-control px-3 py-2 text-body-sm font-semibold text-brand-primary outline-none data-[highlighted]:bg-surface-hover"
                >
                  <PlusGlyph />
                  <SelectPrimitive.ItemText>{createAction.label}</SelectPrimitive.ItemText>
                </SelectPrimitive.Item>
              </>
            ) : null}
          </SelectPrimitive.Viewport>

          <SelectPrimitive.ScrollDownButton className="flex h-6 items-center justify-center text-muted-foreground">
            <CaretGlyph />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

// ─── Glyphs ───────────────────────────────────────────────────────────────────

function CaretGlyph({ className }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn('shrink-0 text-muted-foreground', className)}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function PlusGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M2 6.4l2.6 2.6L10 3.4"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
