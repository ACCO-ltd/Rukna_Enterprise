'use client';

import * as React from 'react';

import { cn } from '../lib/utils';

/**
 * A short list of settings, one per row: what it is on the start edge, the control on the end.
 *
 * ─── When to use it ──────────────────────────────────────────────────────────────
 *
 * For on/off flags and single choices that describe the record rather than name it — "Accepts
 * postings", "Control account". Stacked label-over-input fields make each of those look as weighty
 * as the account's name; a row says "a setting" at a glance and keeps a form short. Names, codes,
 * amounts and dates stay ordinary `FormField`s.
 */
export function SettingsGroup({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'divide-y divide-border/70 rounded-panel border border-border/70 bg-surface-subtle',
        className,
      )}
      {...props}
    />
  );
}

export interface SettingRowProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** The control's id: the label is wired to it, so clicking the words toggles a switch. */
  htmlFor: string;
  label: React.ReactNode;
  /**
   * One line under the label saying what the setting does. Its id is `${htmlFor}-description`;
   * give the control that as `aria-describedby` so a screen reader hears it on focus.
   */
  description?: React.ReactNode;
  /** The control — a `Switch`, a short `Select`. */
  children: React.ReactNode;
}

export function SettingRow({
  htmlFor,
  label,
  description,
  className,
  children,
  ...props
}: SettingRowProps) {
  const descriptionId = description ? `${htmlFor}-description` : undefined;
  return (
    <div
      className={cn('flex items-center justify-between gap-4 px-4 py-3', className)}
      {...props}
    >
      <div className="min-w-0">
        <label
          htmlFor={htmlFor}
          className="block cursor-pointer text-body-sm font-semibold text-foreground"
        >
          {label}
        </label>
        {description ? (
          <p id={descriptionId} className="mt-0.5 text-caption leading-5 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
