'use client';

import type { FormEvent, ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  Button,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
  type FormDialogSize,
} from '@erp/ui';

import { ApiError } from '@/lib/api-client';

/**
 * The one form dialog language for the Administration area, on `FormDialog` (ADR-039).
 *
 * Every create / edit / set-password / manage-roles / permissions dialog reads the same:
 *
 *   • Title      — verb-first and specific ("Add role").
 *   • Subtitle   — one plain sentence stating the rule or consequence.
 *   • Body       — labelled inputs, one field per row at a 20px rhythm; a 2-col grid only for
 *                  genuinely paired fields (first/last name), and that grid is the caller's.
 *   • Footer     — pinned: Cancel (outline) + exactly one primary, which is disabled while
 *                  pending and swaps to a pending verb.
 *
 * What `FormDialog` adds over the plain dialog these used to be: the header and footer stay put
 * while a long body (the permission picker) scrolls, phones get the whole screen, a save in
 * flight blocks every way out (`busy`), and unsaved edits are asked about before Escape, the
 * overlay, the ✕ or Cancel throw them away (`dirty`).
 *
 * Kept as a shell rather than a full <Form> so each form owns its own fields and submit — only
 * the chrome is shared, which is what makes them read consistently.
 */
export function FormDialogShell({
  open,
  onOpenChange,
  title,
  description,
  size = 'md',
  dirty = false,
  busy = false,
  onSubmit,
  footer,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  /** ADR-039: `md` for 1–6 fields, `lg` for a record form or a long picker. */
  size?: FormDialogSize;
  /** Unsaved edits: dismissing asks "Discard unsaved changes?" first. */
  dirty?: boolean;
  /** A save is in flight: every way out is blocked. */
  busy?: boolean;
  /** When set, body and footer are one `<form>`: the footer's submit button submits it. */
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  /** The pinned action row's content — usually `<FormDialogActions>`. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  const tc = useTranslations('common');
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      subtitle={description}
      size={size}
      dirty={dirty}
      busy={busy}
      onSubmit={onSubmit}
      closeLabel={tc('close')}
      discardLabels={{
        title: tc('discardChanges.title'),
        description: tc('discardChanges.description'),
        confirm: tc('discardChanges.confirm'),
        cancel: tc('discardChanges.cancel'),
      }}
    >
      <FormDialogBody className="space-y-5">{children}</FormDialogBody>
      {footer ? <FormDialogFooter>{footer}</FormDialogFooter> : null}
    </FormDialog>
  );
}

/**
 * The standard footer: Cancel (outline, routed through the dialog's dismiss guard so a dirty form
 * asks first) and exactly one primary submit. `pendingLabel` has no default — a caller states the
 * verb ("Creating…").
 */
export function FormDialogActions({
  cancelLabel,
  submitLabel,
  pendingLabel,
  pending,
  disabled,
}: {
  cancelLabel: string;
  submitLabel: string;
  pendingLabel: string;
  pending: boolean;
  /** Extra reasons to keep the primary disabled beyond `pending` (e.g. invalid). */
  disabled?: boolean;
}) {
  return (
    <>
      <FormDialogClose asChild>
        <Button type="button" variant="outline" disabled={pending}>
          {cancelLabel}
        </Button>
      </FormDialogClose>
      <Button type="submit" disabled={pending || disabled}>
        {pending ? pendingLabel : submitLabel}
      </Button>
    </>
  );
}

/** Resolve an API error to a message, preferring the server's own text. */
export function apiMessage(error: unknown, fallback: string): string | undefined {
  if (error instanceof ApiError) return error.message;
  if (error) return fallback;
  return undefined;
}
