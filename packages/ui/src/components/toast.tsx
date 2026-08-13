'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';

import { cn } from '../lib/utils';

/**
 * Transient confirmation of something that happened.
 *
 * ─── Why this exists ─────────────────────────────────────────────────────────────
 *
 * Before this component the product had no way to say that anything had succeeded. A
 * certificate was issued, a journal posted, a payment reversed — and the screen simply
 * changed. On a system where those actions move money, silence after a destructive or
 * irreversible command is the single worst feedback gap in the product.
 *
 * ─── Why it is hand-rolled ───────────────────────────────────────────────────────
 *
 * `@radix-ui/react-toast` would be the obvious choice and is not installed. Adding it means
 * a lockfile change, and this repository has a `fix/ci-stale-lockfile` branch in its history
 * — lockfile churn has cost time here before. What Radix would buy us is swipe-to-dismiss
 * and a focus hotkey; what it would cost is a dependency for two behaviours. The parts that
 * are genuinely hard to get right are the live-region semantics and the timer, and both are
 * below and both are testable.
 *
 * ─── The three rules that make a toast trustworthy ───────────────────────────────
 *
 * 1. **A failure never disappears on a timer.** A success can auto-dismiss because the user
 *    watched it happen; an error may arrive while they are looking elsewhere, and a message
 *    explaining why a journal did not post must still be there when they look back.
 *    `duration: null` is forced for the error tone.
 *
 * 2. **Errors are announced assertively, everything else politely.** Two separate live
 *    regions, because `aria-live` is a property of the region and not of the message. A
 *    single region would either interrupt a screen-reader user for every success or bury a
 *    failure behind whatever they were reading.
 *
 * 3. **Hovering or focusing pauses the timer.** Someone reading a toast, or tabbing to its
 *    action, must not have it vanish mid-sentence.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export interface ToastOptions {
  /** Already-translated. One line, past tense: "Certificate IPC-2026-0042 issued". */
  title: string;
  /**
   * Optional second line. Where a failure explains itself: what went wrong and what to do
   * about it — "Period 2026-08 is closed. Reopen the period or change the accounting date."
   */
  description?: string;
  tone?: ToastTone;
  /**
   * Milliseconds before auto-dismissal, or `null` to require a dismissal.
   * Ignored for the error tone, which is always `null`.
   */
  duration?: number | null;
  /** One action — Undo on a reversible success, Retry on a failure. Never two. */
  action?: { label: string; onClick: () => void };
}

interface ToastRecord extends ToastOptions {
  id: number;
  tone: ToastTone;
  duration: number | null;
}

/** Long enough to read a sentence, short enough not to linger. */
const DEFAULT_DURATION = 5000;

// ─── Context ──────────────────────────────────────────────────────────────────

export interface ToastContextValue {
  toast: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

/**
 * Raise a toast from anywhere under `ToastProvider`.
 *
 * Throws when the provider is missing rather than silently doing nothing: a mutation whose
 * confirmation vanishes because a provider was not mounted is exactly the bug this
 * component exists to prevent, and it must fail loudly in development.
 */
export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a <ToastProvider>. Mount it once at the app root.');
  }
  return ctx;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export interface ToastProviderProps {
  children: React.ReactNode;
  /** Accessible name for the two live regions. Already-translated, e.g. "Notifications". */
  regionLabel: string;
  /** Accessible name for every dismiss button. Already-translated, e.g. "Dismiss". */
  dismissLabel: string;
  /** Cap on simultaneous toasts. Oldest is dropped past this. */
  max?: number;
}

export function ToastProvider({
  children,
  regionLabel,
  dismissLabel,
  max = 4,
}: ToastProviderProps) {
  const [toasts, setToasts] = React.useState<ToastRecord[]>([]);
  const nextId = React.useRef(0);

  const dismiss = React.useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback(
    (options: ToastOptions) => {
      const id = nextId.current++;
      const tone = options.tone ?? 'info';
      setToasts((current) => {
        const record: ToastRecord = {
          ...options,
          id,
          tone,
          // Rule 1: a failure is never dismissed by a timer.
          duration: tone === 'error' ? null : (options.duration ?? DEFAULT_DURATION),
        };
        const next = [...current, record];
        return next.length > max ? next.slice(next.length - max) : next;
      });
      return id;
    },
    [max],
  );

  const value = React.useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport
        toasts={toasts}
        onDismiss={dismiss}
        regionLabel={regionLabel}
        dismissLabel={dismissLabel}
      />
    </ToastContext.Provider>
  );
}

// ─── Viewport ─────────────────────────────────────────────────────────────────

function ToastViewport({
  toasts,
  onDismiss,
  regionLabel,
  dismissLabel,
}: {
  toasts: ToastRecord[];
  onDismiss: (id: number) => void;
  regionLabel: string;
  dismissLabel: string;
}) {
  // Portalled to <body> so a toast is never clipped by an ancestor's `overflow` or trapped
  // beneath a dialog's stacking context. Mounted client-side only: `document` does not
  // exist during the server render.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  // Rule 2: two regions, because aria-live belongs to the region, not the message.
  const assertive = toasts.filter((t) => t.tone === 'error');
  const polite = toasts.filter((t) => t.tone !== 'error');

  return createPortal(
    <div
      // Bottom-end: out of the way of the command header, and on the side the eye returns
      // to after clicking a primary action. Logical inset so it follows the text direction.
      className="pointer-events-none fixed bottom-0 end-0 z-[60] flex w-full max-w-[calc(100vw-2rem)] flex-col gap-2 p-4 sm:max-w-sm"
    >
      <div role="alert" aria-live="assertive" aria-label={regionLabel} className="flex flex-col gap-2">
        {assertive.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={onDismiss} dismissLabel={dismissLabel} />
        ))}
      </div>
      <div role="status" aria-live="polite" aria-label={regionLabel} className="flex flex-col gap-2">
        {polite.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={onDismiss} dismissLabel={dismissLabel} />
        ))}
      </div>
    </div>,
    document.body,
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────

const TONE_STYLES: Record<ToastTone, { frame: string; icon: string }> = {
  success: { frame: 'border-success/25 bg-success-subtle', icon: 'text-success' },
  error: { frame: 'border-danger/25 bg-danger-subtle', icon: 'text-danger' },
  warning: { frame: 'border-warning/25 bg-warning-subtle', icon: 'text-warning' },
  info: { frame: 'border-border bg-surface-elevated', icon: 'text-brand-primary' },
};

function ToastCard({
  toast,
  onDismiss,
  dismissLabel,
}: {
  toast: ToastRecord;
  onDismiss: (id: number) => void;
  dismissLabel: string;
}) {
  const [paused, setPaused] = React.useState(false);
  const tone = TONE_STYLES[toast.tone];

  // Rule 3: the timer is torn down while hovered or focused and restarted on leave, so a
  // toast never vanishes out from under someone reading it or tabbing to its action.
  React.useEffect(() => {
    if (toast.duration === null || paused) return;
    const timer = window.setTimeout(() => onDismiss(toast.id), toast.duration);
    return () => window.clearTimeout(timer);
  }, [toast.duration, toast.id, paused, onDismiss]);

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      className={cn(
        // pointer-events-auto re-enables interaction the viewport disabled, so the gaps
        // between toasts stay click-through to the page beneath.
        'pointer-events-auto flex gap-3 rounded-panel border p-3.5 shadow-e3',
        // motion-safe, not the global duration rule: an entrance that slides is better
        // skipped entirely than played fast for someone who asked for less motion.
        'motion-safe:animate-enter-up',
        tone.frame,
      )}
    >
      <span className={cn('mt-0.5 shrink-0', tone.icon)}>
        <ToneGlyph tone={toast.tone} />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-body-sm font-semibold text-foreground">{toast.title}</p>
        {toast.description ? (
          <p className="mt-1 text-caption leading-5 text-muted-foreground">{toast.description}</p>
        ) : null}
        {toast.action ? (
          <button
            type="button"
            onClick={() => {
              toast.action?.onClick();
              onDismiss(toast.id);
            }}
            className="mt-2 rounded-control text-caption font-semibold text-brand-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:shadow-ring"
          >
            {toast.action.label}
          </button>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label={dismissLabel}
        className="-mt-1 -me-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-muted-foreground transition-colors duration-(--motion-enter) ease-brand hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:shadow-ring"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

/** Colour never carries the tone alone — the glyph is what survives monochrome. */
function ToneGlyph({ tone }: { tone: ToastTone }) {
  if (tone === 'success') {
    return (
      <svg width="15" height="15" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <circle cx="6" cy="6" r="5.2" stroke="currentColor" strokeWidth="1.3" />
        <path d="M3.4 6.2l1.9 1.9L8.7 4.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (tone === 'error') {
    return (
      <svg width="15" height="15" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <circle cx="6" cy="6" r="5.2" stroke="currentColor" strokeWidth="1.3" />
        <path d="M4.1 4.1l3.8 3.8M7.9 4.1L4.1 7.9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  if (tone === 'warning') {
    return (
      <svg width="15" height="15" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M6 1.4l4.9 8.5H1.1L6 1.4z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M6 5v2.1M6 8.6v.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="15" height="15" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <circle cx="6" cy="6" r="5.2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M6 5.3v3.3M6 3.5v.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
