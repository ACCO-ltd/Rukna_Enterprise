'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  FormField,
  Input,
} from '@erp/ui';

import { ApiError } from '@/lib/api-client';

/**
 * The dialog behind a picker's "Add …" row, for registries whose create form is a handful of
 * short text fields.
 *
 * ─── Why this is shared and the district/subtype dialogs are not ─────────────────
 *
 * Four pickers now offer to extend the registry they read from. Two of them earn their own
 * dialog: a district suggests its code from the name, and a subtype is scoped to the category
 * that is already chosen. Suppliers and units of measure have neither — they are two or three
 * required strings and a create call — and writing that twice would be two places for the
 * upper-casing rule and the duplicate check to drift apart.
 *
 * ─── Why the field list is data and not children ─────────────────────────────────
 *
 * A caller passes what it wants captured. That keeps the Enter-key handling, the pending
 * state, the error surface and the focus-on-open in one place; a children-based version would
 * hand all four back to every caller to get right again.
 */

export interface CreateField {
  name: string;
  label: string;
  hint?: string;
  /** Upper-cases as the user types. For codes, which every registry here stores upper. */
  uppercase?: boolean;
  maxLength?: number;
  required?: boolean;
  /** Narrow column, for a short code beside a long name. */
  narrow?: boolean;
}

export function CreateInPickerDialog<TCreated>({
  title,
  description,
  fields,
  submitLabel,
  isPending,
  error,
  onSubmit,
  onDismiss,
}: {
  title: string;
  description?: string;
  fields: readonly CreateField[];
  submitLabel: string;
  isPending: boolean;
  /** Already-resolved failure text, or an ApiError to read the server's message from. */
  error?: unknown;
  /** Receives the trimmed values, keyed by field name. */
  onSubmit: (values: Record<string, string>) => void;
  onDismiss: () => void;
}) {
  const tCommon = useTranslations('common');
  const firstRef = useRef<HTMLInputElement>(null);
  const [values, setValues] = useState<Record<string, string>>({});

  const read = (name: string) => values[name] ?? '';
  const complete = fields.every((field) => !field.required || read(field.name).trim().length > 0);
  const canSubmit = complete && !isPending;

  const message =
    error instanceof ApiError && error.messages.length > 0 ? error.message : undefined;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit(
      Object.fromEntries(fields.map((field) => [field.name, read(field.name).trim()])),
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !isPending) onDismiss();
      }}
    >
      <DialogContent
        closeLabel={tCommon('close')}
        className="sm:max-w-lg"
        onEscapeKeyDown={(event) => {
          if (isPending) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (isPending) event.preventDefault();
        }}
        onOpenAutoFocus={(event) => {
          // Radix focuses the close control; the point of the dialog is the first field.
          event.preventDefault();
          firstRef.current?.focus();
        }}
      >
        <DialogTitle>{title}</DialogTitle>
        {description ? <p className="mt-2 text-body-sm text-muted-foreground">{description}</p> : null}

        {message ? (
          <div className="mt-4">
            <Alert variant="error" messages={[message]} />
          </div>
        ) : null}

        <div
          className="mt-5 space-y-4"
          // The dialog opens from inside another form. Enter must add the record, not submit
          // whatever is behind it.
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            submit();
          }}
        >
          {fields.map((field, index) => (
            <FormField
              key={field.name}
              htmlFor={`create-${field.name}`}
              label={field.label}
              hint={field.hint}
              className={field.narrow ? 'max-w-40' : undefined}
              required={field.required}
            >
              <Input
                id={`create-${field.name}`}
                ref={index === 0 ? firstRef : undefined}
                value={read(field.name)}
                maxLength={field.maxLength}
                autoComplete="off"
                className={field.uppercase ? 'font-mono' : undefined}
                onChange={(event) => {
                  const next = field.uppercase
                    ? event.target.value.toUpperCase()
                    : event.target.value;
                  setValues((current) => ({ ...current, [field.name]: next }));
                }}
              />
            </FormField>
          ))}
        </div>

        <DialogFooter>
          <Button type="button" onClick={submit} disabled={!canSubmit}>
            {isPending ? tCommon('formActions.pendingLabel') : submitLabel}
          </Button>
          <Button type="button" variant="outline" onClick={onDismiss} disabled={isPending}>
            {tCommon('cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
