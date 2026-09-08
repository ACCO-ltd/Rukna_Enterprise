import type { ReactNode } from 'react';

/**
 * One screen inside the Administration workspace.
 *
 * The heading is an `h2` because the workspace above it is the `h1` — see `AdminShell`. The
 * action lives in the header row rather than floating above the table on a row of its own,
 * which is where "Add user" and "Add role" used to sit: a naked button with no heading beside
 * it does not say what it will add.
 */
export function AdminPanel({
  title,
  description,
  actions,
  headingLevel = 2,
  children,
}: {
  title: string;
  /** One line on what this screen is for. Sits under the title. */
  description?: string;
  /** Right-aligned control(s) — typically the screen's one primary action. */
  actions?: ReactNode;
  /**
   * The panel's heading level. `2` by default, because a screen inside the Administration
   * workspace sits under the shell's `h1`.
   *
   * Pass `3` when the *screen* names itself above its panels — Workflows holds two panels, so
   * its own name is an `h2` and each panel is one level under it. Without this a screen with
   * two panels either has two peer headings and no name, or skips a level to acquire one.
   */
  headingLevel?: 2 | 3;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-panel border border-border bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          {headingLevel === 3 ? (
            <h3 className="text-h3 font-semibold text-foreground">{title}</h3>
          ) : (
            <h2 className="text-h2 font-semibold text-foreground">{title}</h2>
          )}
          {description ? (
            <p className="mt-1 max-w-prose text-body-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      <div className="px-5 py-5">{children}</div>
    </section>
  );
}
