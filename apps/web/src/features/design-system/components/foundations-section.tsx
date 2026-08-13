'use client';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableScroll } from '@erp/ui';

import { Pending, Rule, Section, Specimen } from './gallery-chrome';

// ─── Type scale ───────────────────────────────────────────────────────────────

/**
 * The eight steps, with the weight each one is intended to carry. Weight is not
 * baked into the `text-*` token — see the comment in `globals.css` for why — so
 * it is listed here and applied explicitly.
 */
const TYPE_STEPS = [
  {
    token: 'text-display',
    metrics: '30 / 36 · -0.02em',
    weight: 'font-bold',
    weightLabel: '700',
    sample: 'Interim Payment Certificate',
    use: 'One per page at most. Record titles that are the page.',
  },
  {
    token: 'text-h1',
    metrics: '24 / 32 · -0.015em',
    weight: 'font-bold',
    weightLabel: '700',
    sample: 'Purchase Order PO-2026-00418',
    use: 'Standard page title. What PageHeader renders.',
  },
  {
    token: 'text-h2',
    metrics: '18 / 26 · -0.01em',
    weight: 'font-semibold',
    weightLabel: '600',
    sample: 'Bill of Quantities — Revision 3',
    use: 'Panel and section headings.',
  },
  {
    token: 'text-h3',
    metrics: '15 / 22',
    weight: 'font-semibold',
    weightLabel: '600',
    sample: 'Deductions and retention',
    use: 'Sub-sections, form group titles, card headings.',
  },
  {
    token: 'text-body',
    metrics: '14 / 22',
    weight: 'font-normal',
    weightLabel: '400',
    sample:
      'Cumulative claimed quantity is measured to date, not for this period. The period figure is cumulative minus the previously certified quantity.',
    use: 'Default. Everything not covered by another step.',
  },
  {
    token: 'text-body-sm',
    metrics: '13 / 20',
    weight: 'font-normal',
    weightLabel: '400',
    sample: 'Unit rate and currency are taken from the BOQ node and cannot be edited here.',
    use: 'Secondary prose, hints, dense table cells.',
  },
  {
    token: 'text-caption',
    metrics: '12 / 16',
    weight: 'font-medium',
    weightLabel: '500',
    sample: 'Locked when the contract was executed on 4 March 2026',
    use: 'Metadata, timestamps, field hints, footnotes.',
  },
  {
    token: 'text-micro',
    metrics: '11 / 14 · +0.06em',
    weight: 'font-semibold uppercase',
    weightLabel: '600 · caps',
    sample: 'Certified this period',
    use: 'Eyebrows, column headers, tile labels. Always uppercase.',
  },
] as const;

// ─── Colour ───────────────────────────────────────────────────────────────────

/**
 * Class names are written out in full rather than composed, because Tailwind
 * scans source text — a template-built `bg-${name}` generates nothing.
 */
const COLOUR_GROUPS = [
  {
    group: 'Canvas and surface',
    swatches: [
      { token: 'background', cls: 'bg-background', use: 'Page canvas' },
      { token: 'surface', cls: 'bg-surface', use: 'Panels, cards, rows' },
      { token: 'surface-subtle', cls: 'bg-surface-subtle', use: 'Table headers, sunken areas' },
      { token: 'surface-hover', cls: 'bg-surface-hover', use: 'Row and item hover' },
      { token: 'surface-selected', cls: 'bg-surface-selected', use: 'Selected row' },
      { token: 'muted', cls: 'bg-muted', use: 'Inert fills, skeletons' },
    ],
  },
  {
    group: 'Line and text',
    swatches: [
      { token: 'border', cls: 'bg-border', use: 'Default hairline' },
      { token: 'border-strong', cls: 'bg-border-strong', use: 'Control borders' },
      { token: 'border-interactive', cls: 'bg-border-interactive', use: 'Control hover' },
      { token: 'foreground', cls: 'bg-foreground', use: 'Primary text' },
      { token: 'brand-ink-soft', cls: 'bg-brand-ink-soft', use: 'Body text' },
      { token: 'muted-foreground', cls: 'bg-muted-foreground', use: 'Secondary text' },
    ],
  },
  {
    group: 'Brand — the only layer a tenant may override',
    swatches: [
      { token: 'brand-primary', cls: 'bg-brand-primary', use: 'Primary action, focus, active nav' },
      { token: 'brand-primary-hover', cls: 'bg-brand-primary-hover', use: 'Hover' },
      { token: 'brand-accent', cls: 'bg-brand-accent', use: 'Selected and informational fills' },
      { token: 'brand-panel', cls: 'bg-brand-panel', use: 'Dark navigation panel' },
    ],
  },
  {
    group: 'Status — platform-owned, never re-branded',
    swatches: [
      { token: 'success', cls: 'bg-success', use: 'In force, certified, paid' },
      { token: 'warning', cls: 'bg-warning', use: 'Needs attention, winding down' },
      { token: 'danger', cls: 'bg-danger', use: 'Stopped short, rejected, destructive' },
      { token: 'historical', cls: 'bg-historical', use: 'Superseded, archived' },
    ],
  },
] as const;

// ─── Component ────────────────────────────────────────────────────────────────

export function FoundationsSection() {
  return (
    <>
      {/* ── Type ────────────────────────────────────────────────────────── */}
      <Section
        id="type"
        title="Type scale"
        intro={
          <>
            Eight steps, anchored on the existing 14px body so nothing reflows. Every one of
            the 14 arbitrary <code className="font-mono text-caption">text-[Npx]</code> values
            in the codebase maps onto one of these.
          </>
        }
      >
        <Specimen label="Type scale" token="--text-*">
          <div className="flex flex-col">
            {TYPE_STEPS.map((step) => (
              <div
                key={step.token}
                className="grid gap-2 border-b border-dashed border-border py-3.5 last:border-b-0 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-6"
              >
                <div className="font-mono text-micro leading-5 text-muted-foreground">
                  <span className="block font-semibold uppercase text-brand-primary">
                    {step.token}
                  </span>
                  {step.metrics}
                  <br />
                  {step.weightLabel}
                </div>
                <div className="min-w-0">
                  <p className={`${step.token} ${step.weight} text-foreground`}>{step.sample}</p>
                  <p className="mt-1.5 text-caption text-muted-foreground">{step.use}</p>
                </div>
              </div>
            ))}
          </div>
        </Specimen>

        <Specimen
          label="Numerals and identifiers"
          token="tabular-nums · font-mono"
          note="Proportional figures make a money column ragged, which is how a transposed digit survives review. Identifiers set in mono so a document number is never mistaken for a name."
        >
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <p className="text-micro font-semibold uppercase text-muted-foreground">
                Correct — tabular
              </p>
              <div className="mt-2 flex flex-col text-body tabular-nums text-foreground">
                <span>1 204 750.00</span>
                <span>486 200.00</span>
                <span>62 411.75</span>
                <span>1 118 400.00</span>
              </div>
            </div>
            <div>
              <p className="text-micro font-semibold uppercase text-muted-foreground">
                Wrong — proportional
              </p>
              <div className="mt-2 flex flex-col text-body text-muted-foreground">
                <span>1 204 750.00</span>
                <span>486 200.00</span>
                <span>62 411.75</span>
                <span>1 118 400.00</span>
              </div>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <code className="font-mono text-caption text-muted-foreground">IPC-2026-0042</code>
            <code className="font-mono text-caption text-muted-foreground">PO-2026-00418 R2</code>
            <code className="font-mono text-caption text-muted-foreground">41200 · Retention</code>
          </div>
        </Specimen>

        <Rule>
          Weight is never baked into a <code className="font-mono text-caption">text-*</code>{' '}
          token, so it stays visible at the call site and composition order can never surprise
          anyone. 600 is the heaviest heading weight below h1: Inter is loaded variable and
          would render 650 faithfully, but IBM Plex Sans Arabic is loaded at fixed weights — so
          a 650 heading would be 650 in English and 700 in Arabic on the same document.
        </Rule>
      </Section>

      {/* ── Colour ──────────────────────────────────────────────────────── */}
      <Section
        id="colour"
        title="Colour"
        intro="Unchanged from what already shipped. Cobalt on a cool grey canvas is a credible enterprise identity and the neutrals are already hue-biased toward it. What is new is only the ownership rule."
      >
        {COLOUR_GROUPS.map((group) => (
          <Specimen key={group.group} label={group.group}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.swatches.map((swatch) => (
                <div
                  key={swatch.token}
                  className="overflow-hidden rounded-panel border border-border bg-surface"
                >
                  <div className={`h-12 border-b border-border ${swatch.cls}`} />
                  <div className="px-3 py-2">
                    <code className="font-mono text-caption text-foreground">{swatch.token}</code>
                    <p className="text-caption text-muted-foreground">{swatch.use}</p>
                  </div>
                </div>
              ))}
            </div>
          </Specimen>
        ))}

        <Rule>
          Semantic colour is never the accent, and the accent never carries state meaning. A
          tenant may re-brand <code className="font-mono text-caption">brand-*</code>; it may
          never re-brand a status, a border or a text colour, because those carry accessibility
          and business meaning. Status is always accompanied by a label and a glyph, so it
          survives a colour-blind reader, a monochrome print and a site-office monitor.
        </Rule>
      </Section>

      {/* ── Geometry ────────────────────────────────────────────────────── */}
      <Section
        id="geometry"
        title="Radius and elevation"
        intro="Radius encodes nesting depth; elevation encodes intent. Three values each, and nothing between them."
      >
        <Specimen label="Radius" token="rounded-control · panel · container · full">
          <div className="flex flex-wrap gap-6">
            {[
              { cls: 'rounded-control', px: '6px', name: 'control', use: 'input, button, chip, tab' },
              { cls: 'rounded-panel', px: '10px', name: 'panel', use: 'card, table, dialog' },
              {
                cls: 'rounded-container',
                px: '14px',
                name: 'container',
                use: 'workspace shell, page frame',
              },
              { cls: 'rounded-full', px: 'full', name: 'full', use: 'status, avatar, count' },
            ].map((r) => (
              <figure key={r.name} className="m-0">
                <div
                  className={`h-14 w-20 border border-border-strong bg-surface shadow-e1 ${r.cls}`}
                />
                <figcaption className="mt-2 font-mono text-micro leading-5 text-muted-foreground">
                  <span className="block font-semibold text-foreground">{r.px}</span>
                  {r.name}
                  <br />
                  {r.use}
                </figcaption>
              </figure>
            ))}
          </div>
        </Specimen>

        <Specimen label="Elevation" token="shadow-e1 · e2 · e3 · ring">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                cls: 'shadow-e1',
                name: 'e1 · resting',
                use: 'Panels, cards, table frames, inputs. Almost invisible — it exists only to lift surface off canvas.',
              },
              {
                cls: 'shadow-e2',
                name: 'e2 · raised',
                use: 'Dropdowns, popovers, sticky headers, a summary rail once it detaches.',
              },
              {
                cls: 'shadow-e3',
                name: 'e3 · overlay',
                use: 'Dialogs, sheets, command palette. Always paired with a scrim.',
              },
              {
                cls: 'shadow-ring',
                name: 'ring · focus',
                use: 'Keyboard focus only. Never used to express elevation.',
              },
            ].map((e) => (
              <div
                key={e.name}
                className={`rounded-panel border border-border bg-surface p-4 ${e.cls}`}
              >
                <p className="text-body-sm font-semibold text-foreground">{e.name}</p>
                <p className="mt-1 text-caption leading-5 text-muted-foreground">{e.use}</p>
              </div>
            ))}
          </div>
        </Specimen>

        <Pending>
          68 places still spell elevation as{' '}
          <code className="font-mono text-caption">shadow-[var(--shadow-panel)]</code>. Phase 1
          replaces them with <code className="font-mono text-caption">shadow-e2</code>, and 290
          ad-hoc <code className="font-mono text-caption">rounded-lg|md|xl</code> with the three
          radius tokens.
        </Pending>
      </Section>

      {/* ── Space, motion, density ──────────────────────────────────────── */}
      <Section
        id="space"
        title="Space, motion and density"
        intro="Space is a 4pt grid with a preferred set. Motion is three durations and one curve. Density is the one scale a user controls."
      >
        <Specimen
          label="Spacing — preferred set"
          token="4pt grid"
          note="Ten values cover almost everything. Half-steps (0.5, 1.5, 2.5, 3.5 → 2, 6, 10, 14px) stay available for dense controls where 4px is too coarse — they are on a 2pt grid, not off it. What is forbidden is the genuinely off-grid integer: p-7, p-9, p-11 and friends are always accidents."
        >
          <div className="flex flex-col gap-2">
            {[
              { t: '1', px: 4 },
              { t: '2', px: 8 },
              { t: '3', px: 12 },
              { t: '4', px: 16 },
              { t: '5', px: 20 },
              { t: '6', px: 24 },
              { t: '8', px: 32 },
              { t: '10', px: 40 },
              { t: '12', px: 48 },
              { t: '16', px: 64 },
            ].map((s) => (
              <div key={s.t} className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-3">
                <span className="text-end font-mono text-caption tabular-nums text-muted-foreground">
                  {s.t} · {s.px}px
                </span>
                <span
                  className="h-3 rounded-sm bg-brand-primary/80"
                  style={{ width: `${s.px}px` }}
                />
              </div>
            ))}
          </div>
        </Specimen>

        <Specimen label="Motion and density" token="--motion-* · --row-height" bare>
          <TableScroll className="rounded-none border-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Token</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Applies to</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-mono text-caption">--motion-exit</TableCell>
                  <TableCell className="font-mono text-caption tabular-nums">120ms</TableCell>
                  <TableCell>Dismiss, close, fade out. Leaving is always faster than arriving.</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono text-caption">--motion-enter</TableCell>
                  <TableCell className="font-mono text-caption tabular-nums">180ms</TableCell>
                  <TableCell>Open, reveal, hover, focus ring.</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono text-caption">--motion-layout</TableCell>
                  <TableCell className="font-mono text-caption tabular-nums">240ms</TableCell>
                  <TableCell>Sidebar collapse, accordion, panel resize.</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono text-caption">ease-brand</TableCell>
                  <TableCell className="font-mono text-caption">
                    cubic-bezier(.2,.8,.2,1)
                  </TableCell>
                  <TableCell>Everything. One curve.</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono text-caption">h-row · h-control</TableCell>
                  <TableCell className="font-mono text-caption tabular-nums">44px / 36px</TableCell>
                  <TableCell>
                    Comfortable by default, compact when the user asks. Switch it in the
                    toolbar above and watch this table.
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono text-caption">reduced motion</TableCell>
                  <TableCell className="font-mono text-caption tabular-nums">1ms</TableCell>
                  <TableCell>
                    All three collapse under <code className="font-mono text-caption">prefers-reduced-motion</code>{' '}
                    in one global rule. 1ms rather than 0, because a transition that never
                    fires <code className="font-mono text-caption">transitionend</code> leaves
                    some Radix panels mounted forever.
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableScroll>
        </Specimen>

        <Specimen
          label="Density — live"
          token="h-row"
          note="These rows read their height from the density token. Everything else on this page that should respond to density but does not is Phase 1 work."
        >
          <div className="overflow-hidden rounded-panel border border-border">
            {['BILL-2026-0311', 'BILL-2026-0310', 'BILL-2026-0309', 'BILL-2026-0308'].map(
              (id, i) => (
                <div
                  key={id}
                  className={`flex h-row items-center gap-4 bg-surface px-3 ${
                    i > 0 ? 'border-t border-border' : ''
                  }`}
                >
                  <code className="font-mono text-caption text-muted-foreground">{id}</code>
                  <span className="text-body-sm text-foreground">Horyaal Building Materials</span>
                  <span className="ms-auto text-body-sm font-medium tabular-nums text-foreground">
                    486 200.00
                  </span>
                </div>
              ),
            )}
          </div>
        </Specimen>

        <Pending>
          <code className="font-mono text-caption">Button</code>,{' '}
          <code className="font-mono text-caption">Input</code>,{' '}
          <code className="font-mono text-caption">Select</code> and{' '}
          <code className="font-mono text-caption">TableHead</code> still hardcode{' '}
          <code className="font-mono text-caption">h-11</code>, so the density toggle does not
          reach them. Phase 1 swaps those for{' '}
          <code className="font-mono text-caption">h-control</code> and{' '}
          <code className="font-mono text-caption">h-row</code>. The toggle is wired and
          persisted now so the plumbing is proven before the sweep touches 244 components.
        </Pending>
      </Section>
    </>
  );
}
