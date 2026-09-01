'use client';

import type { ReactNode } from 'react';
import { Button, Sheet, SheetContent, SheetDescription, SheetTitle } from '@erp/ui';

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
 * than a full <Form> so each sheet owns its own fields and submit — only the chrome is shared,
 * which is what makes them read consistently.
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex max-h-full flex-col p-0">
        <div className="border-b border-border px-6 pb-4 pt-6">
          <SheetTitle className="text-base font-semibold leading-6 text-foreground">
            {title}
          </SheetTitle>
          {description ? (
            <SheetDescription className="mt-1 text-sm leading-5 text-muted-foreground">
              {description}
            </SheetDescription>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </SheetContent>
    </Sheet>
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
