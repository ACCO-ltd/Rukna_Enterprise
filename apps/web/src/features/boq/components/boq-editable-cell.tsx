'use client';

import { useRef, useState } from 'react';
import { cn } from '@erp/ui';

/**
 * A grid cell you edit in place (BOQ refinement Phase 5 — D1: inline edit for quantity, rate and
 * description on the Working BOQ). A QS repricing a bill edits dozens of rates; opening a dialog for
 * each is the friction this removes.
 *
 * Not editable → it renders the plain display and nothing else changes (a frozen Contract BOQ, or a
 * viewer, sees static cells). Editable → the value gets a click-to-edit affordance; a click swaps in
 * an input. Enter or blur commits, Escape cancels. The commit is awaited (`mutateAsync`), so the
 * cell shows a saving state and, on failure, an error ring while staying open for a retry — a bad
 * value never silently disappears.
 *
 * `stopPropagation` throughout: the row itself is click-to-open-the-editor, and editing a cell must
 * not also open that dialog.
 */

const PATTERNS: Record<'quantity' | 'rate', RegExp> = {
  quantity: /^\d+(\.\d{1,3})?$/,
  rate: /^\d+(\.\d{1,2})?$/,
};

const MAX_TEXT = 500;

export function EditableCell({
  value,
  display,
  editable,
  kind,
  numeric = false,
  ariaLabel,
  onCommit,
}: {
  /** The raw current value the input seeds from (e.g. "10.000"); null when unset. */
  value: string | null;
  /** How the value reads when not editing (formatted number, description text, or "—"). */
  display: React.ReactNode;
  editable: boolean;
  kind: 'text' | 'quantity' | 'rate';
  numeric?: boolean;
  ariaLabel: string;
  onCommit: (next: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const skipBlur = useRef(false);

  if (!editable) return <>{display}</>;

  if (!editing) {
    return (
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={(event) => {
          event.stopPropagation();
          setDraft(value ?? '');
          setInvalid(false);
          setEditing(true);
        }}
        className={cn(
          'group/edit -mx-1 flex w-full rounded-control px-1 text-start hover:bg-surface-hover',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary',
          numeric && 'justify-end text-end',
        )}
      >
        {/* A dashed underline on hover says "editable" without adding chrome at rest. */}
        <span className="min-w-0 border-b border-dashed border-transparent group-hover/edit:border-border">
          {display}
        </span>
      </button>
    );
  }

  const isValid = (candidate: string): boolean => {
    const trimmed = candidate.trim();
    if (kind === 'text') return trimmed.length > 0 && trimmed.length <= MAX_TEXT;
    return PATTERNS[kind].test(trimmed);
  };

  const commit = async () => {
    const next = draft.trim();
    if (next === (value ?? '')) {
      setEditing(false);
      return;
    }
    if (!isValid(next)) {
      setInvalid(true);
      return;
    }
    setSaving(true);
    try {
      await onCommit(next);
      setEditing(false);
    } catch {
      setInvalid(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <input
      autoFocus
      value={draft}
      disabled={saving}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      inputMode={kind === 'text' ? undefined : 'decimal'}
      dir={kind === 'text' ? undefined : 'ltr'}
      maxLength={kind === 'text' ? MAX_TEXT : undefined}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => {
        setDraft(event.target.value);
        setInvalid(false);
      }}
      onBlur={() => {
        if (skipBlur.current) {
          skipBlur.current = false;
          setEditing(false);
          setInvalid(false);
          return;
        }
        void commit();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          void commit();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          // Cancel: flag the blur that follows so it does not commit the reverted value.
          skipBlur.current = true;
          event.currentTarget.blur();
        }
      }}
      className={cn(
        '-mx-1 w-full rounded-control border bg-surface px-1 py-0.5 text-body-sm',
        numeric && 'text-end tabular-nums',
        invalid ? 'border-danger outline-danger' : 'border-brand-primary',
      )}
    />
  );
}
