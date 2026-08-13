'use client';

import { useState } from 'react';
import { cn, DirectionProvider } from '@erp/ui';

import {
  setDensityPreference,
  useDensityPreference,
} from '@/features/theme/density-store';
import type { DensityPreference } from '@/features/theme/density-preference';
import { setThemePreference, useThemePreference } from '@/features/theme/theme-store';
import type { ThemePreference } from '@/features/theme/theme-preference';

import { ControlsSection } from './controls-section';
import { FoundationsSection } from './foundations-section';
import { PatternsSection } from './patterns-section';
import { RecordsSection } from './records-section';

// ─── Contents ─────────────────────────────────────────────────────────────────

const CONTENTS = [
  { id: 'type', label: 'Type scale' },
  { id: 'colour', label: 'Colour' },
  { id: 'geometry', label: 'Radius and elevation' },
  { id: 'space', label: 'Space, motion, density' },
  { id: 'buttons', label: 'Buttons' },
  { id: 'fields', label: 'Fields' },
  { id: 'forms', label: 'Form composition' },
  { id: 'toast', label: 'Toast' },
  { id: 'status', label: 'Status' },
  { id: 'data', label: 'Tables' },
  { id: 'feedback', label: 'Feedback' },
  { id: 'flow', label: 'Progress and guidance' },
  { id: 'overlays', label: 'Overlays' },
  { id: 'tiles', label: 'Stat tiles' },
  { id: 'record', label: 'Record layout' },
  { id: 'approval', label: 'Approval' },
  { id: 'views', label: 'Saved views' },
  { id: 'wizard', label: 'Guided flows' },
] as const;

// ─── Toggle group ─────────────────────────────────────────────────────────────

function ToggleGroup<T extends string>({
  legend,
  value,
  options,
  onChange,
}: {
  legend: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1 text-micro font-semibold uppercase text-muted-foreground">
        {legend}
      </legend>
      <div className="flex rounded-control border border-border-strong bg-surface p-0.5 shadow-e1">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              className={cn(
                // rounded-control, not an arbitrary 4px: this page documents the radius
                // scale, so it has no business being the one file that steps outside it.
                'rounded-control px-2.5 py-1 text-caption font-semibold transition-colors',
                'duration-(--motion-enter) ease-brand',
                'focus-visible:outline-none focus-visible:shadow-ring',
                active
                  ? 'bg-brand-primary text-brand-on-primary'
                  : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

// ─── Gallery ──────────────────────────────────────────────────────────────────

/**
 * The design system's review surface.
 *
 * Every primitive, in every state, with the three switches that a component has
 * to survive: theme, direction, density. The rule this page exists to enforce is
 * that no shared component is approved from a description — it is approved here,
 * flipped through all three switches.
 *
 * Direction is applied to a wrapper rather than the document, so the toolbar
 * stays put while the specimens flip. It nests a second `DirectionProvider`
 * inside the root one, because Radix primitives read direction from context and
 * not from the DOM — without it a `Tabs` inside an RTL wrapper would keep
 * left-to-right arrow keys and quietly pass the review.
 */
export function Gallery() {
  const theme = useThemePreference();
  const density = useDensityPreference();
  const [dir, setDir] = useState<'ltr' | 'rtl'>('ltr');

  return (
    <div className="min-h-screen bg-background">
      {/* ── Toolbar ────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-end gap-x-6 gap-y-3 px-5 py-3">
          <div className="me-auto min-w-0">
            <p className="text-h3 font-semibold text-foreground">Rukna design system</p>
            <p className="text-caption text-muted-foreground">
              Every primitive, in every state, through all three switches.
            </p>
          </div>

          <ToggleGroup<ThemePreference>
            legend="Theme"
            value={theme}
            onChange={setThemePreference}
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
              { value: 'system', label: 'System' },
            ]}
          />

          <ToggleGroup<'ltr' | 'rtl'>
            legend="Direction"
            value={dir}
            onChange={setDir}
            options={[
              { value: 'ltr', label: 'LTR' },
              { value: 'rtl', label: 'RTL' },
            ]}
          />

          <ToggleGroup<DensityPreference>
            legend="Density"
            value={density}
            onChange={setDensityPreference}
            options={[
              { value: 'comfortable', label: 'Comfortable' },
              { value: 'compact', label: 'Compact' },
            ]}
          />
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-5 py-10">
        {/* ── Masthead ─────────────────────────────────────────────────── */}
        <header className="max-w-[68ch]">
          <p className="text-micro font-semibold uppercase text-brand-primary">Phase 0</p>
          <h1 className="mt-3 text-display font-bold text-foreground">Design system</h1>
          <p className="mt-3 text-body text-brand-ink-soft">
            The scales are closed sets: eight type steps, three radii, three elevations, three
            durations, one curve, two densities. A value outside them is a bug, not a choice.
            Panels marked <span className="font-semibold text-warning">Not yet</span> are the gap
            between this specification and the code — they are the Phase 1 and Phase 2 worklist,
            kept beside the specimen they concern so the list cannot drift from what it
            describes.
          </p>
        </header>

        {/* ── Contents ─────────────────────────────────────────────────── */}
        <nav aria-label="Contents" className="mt-8">
          <ul className="flex flex-wrap gap-2">
            {CONTENTS.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  className="inline-flex rounded-full border border-border bg-surface px-3 py-1 text-caption font-medium text-muted-foreground shadow-e1 transition-colors duration-(--motion-enter) ease-brand hover:border-brand-primary/30 hover:bg-brand-accent hover:text-brand-primary focus-visible:outline-none focus-visible:shadow-ring"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {/* ── Specimens ────────────────────────────────────────────────── */}
        <DirectionProvider dir={dir}>
          <div dir={dir} className="mt-12 flex flex-col gap-12">
            <FoundationsSection />
            <ControlsSection />
            <PatternsSection />
            <RecordsSection />
          </div>
        </DirectionProvider>

        <footer className="mt-16 border-t border-border pt-6">
          <p className="max-w-[70ch] text-caption leading-6 text-muted-foreground">
            This page is a developer surface and is deliberately English-only — it documents the
            system rather than shipping to a tenant, and putting its prose in the translation
            catalogues would add hundreds of keys that no user ever reads while making the en/ar
            parity test harder to trust. Every specimen it renders is still verified in Arabic
            through the direction toggle above.
          </p>
        </footer>
      </div>
    </div>
  );
}
