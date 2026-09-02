'use client';

import type { ReactNode } from 'react';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@erp/ui';

import { ApiError } from '@/lib/api-client';

/**
 * The one form/lifecycle dialog language for the Administration area (design §6).
 *
 * Every create/edit/set-password/manage-roles/permissions sheet reads the same:
 *
 *   • Title      — section type (16/24·600), verb-first & specific ("Add role").
 *   • Helper     — one plain sentence stating the rule or consequence.
 *   • Hairline   — separates the header from the body.
 *   • Body       — labelled inputs (labels above), one field per row, 32px section gap
 *                  is the caller's; the shell owns the 20px field rhythm via <FormBody>.
 *   • Footer     — hairline above, Cancel (outline) + exactly one primary. The primary is
 *                  disabled while pending; its label swaps to a pending verb.
 *
 * Modelled on the "Add role" reference and screens/create-form.html. Kept as a shell rather
 * than a full <Form> so each form owns its own fields and submit — only the chrome is shared,
 * which is what makes them read consistently.
 *
 * ─── Why a dialog and not the side panel it used to be ───────────────────────────
 *
 * These are short forms — four or five fields — asked in the middle of a table. A side panel
 * keeps the page visible behind it, which is worth something when you are checking a record
 * while acting on it; none of these need that, because the field you are filling in does not
 * depend on the row behind the panel. What the panel did cost was width: 420px, on screens
 * where 900px was available, so a two-column pair like first/last name never had room.
 *
 * The one place a panel still earned its keep is comparison — and 420px was the worst width
 * for that too, so nothing is left holding the primitive up.
 */
export function FormSheetShell({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
        <div className="mt-5">{children}</div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The stacked-field body: one field per row at the design's 20px field gap. A 2-col grid is
 * reserved for genuinely paired fields (first/last name) and is the caller's own wrapper.
 */
export function FormBody({ children, ...props }: React.FormHTMLAttributes<HTMLFormElement>) {
  return (
    <form className="space-y-5" noValidate {...props}>
      {children}
    </form>
  );
}

/**
 * The shared footer: a hairline divider, Cancel (outline) on the left of the wrap, and exactly
 * one primary. The primary is disabled while pending and shows a pending label. `pendingLabel`
 * defaults nowhere — a caller states the verb ("Creating…").
 */
export function FormFooter({
  onCancel,
  cancelLabel,
  submitLabel,
  pendingLabel,
  pending,
  disabled,
}: {
  onCancel: () => void;
  cancelLabel: string;
  submitLabel: string;
  pendingLabel: string;
  pending: boolean;
  /** Extra reasons to keep the primary disabled beyond `pending` (e.g. invalid). */
  disabled?: boolean;
}) {
  return (
    <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-border pt-4">
      <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
        {cancelLabel}
      </Button>
      <Button type="submit" disabled={pending || disabled}>
        {pending ? pendingLabel : submitLabel}
      </Button>
    </div>
  );
}

/** Resolve an API error to a message, preferring the server's own text. */
export function apiMessage(error: unknown, fallback: string): string | undefined {
  if (error instanceof ApiError) return error.message;
  if (error) return fallback;
  return undefined;
}
