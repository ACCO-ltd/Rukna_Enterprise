'use client';

import * as React from 'react';
import { DirectionProvider as RadixDirectionProvider } from '@radix-ui/react-direction';

/**
 * Tells every Radix primitive which way the page reads.
 *
 * ─── Why this is not optional ────────────────────────────────────────────────────
 *
 * Radix components do NOT inherit direction from the DOM. Each one resolves `dir` from
 * this provider and falls back to a hard-coded `"ltr"` when it is absent — so
 * `Tabs.Root` renders `<div dir="ltr">` on an Arabic page, and every child inside it
 * silently flips back to left-to-right no matter what `<html dir="rtl">` says.
 *
 * That is not a subtle degradation. It was caught in browser QA: the contract detail
 * screen rendered its heading right-aligned and everything inside the tabs left-aligned,
 * on the same page, and the same monetary value rendered two different ways depending on
 * which side of the boundary it sat.
 *
 * Mounting this once at the app root fixes every current and future Radix primitive at the
 * same time, rather than leaving each caller to remember a `dir` prop.
 *
 * The app passes its resolved locale direction; `packages/ui` deliberately knows nothing
 * about how that is determined.
 */
export function DirectionProvider({
  dir,
  children,
}: {
  dir: 'ltr' | 'rtl';
  children: React.ReactNode;
}) {
  return <RadixDirectionProvider dir={dir}>{children}</RadixDirectionProvider>;
}
