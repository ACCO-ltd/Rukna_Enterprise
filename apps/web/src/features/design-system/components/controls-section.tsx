'use client';

import { Button, FormField, FormSection, Input, Label, Select, Textarea } from '@erp/ui';

import { Pending, Row, Rule, Section, Specimen } from './gallery-chrome';

/**
 * Controls: buttons and the field set.
 *
 * The field specimens are the important half. `Input` today has a pristine
 * state and an error border, and the reference set this system was drawn from
 * carries six states — the gap is marked with `Pending` beside the states that
 * do not exist yet, rather than mocked up as though they do.
 */
export function ControlsSection() {
  return (
    <>
      {/* ── Buttons ─────────────────────────────────────────────────────── */}
      <Section
        id="buttons"
        title="Buttons"
        intro="Four variants, one hierarchy. A screen shows at most one default button; everything else is outline or ghost. Two visible actions plus an overflow is the ceiling on a record header."
      >
        <Specimen label="Variants" token="<Button variant>">
          <div className="flex flex-col">
            <Row label="default">
              <Button>Approve</Button>
              <Button disabled>Approve</Button>
              <span className="text-caption text-muted-foreground">
                The single primary action. One per screen.
              </span>
            </Row>
            <Row label="outline">
              <Button variant="outline">Return for changes</Button>
              <Button variant="outline" disabled>
                Return for changes
              </Button>
              <span className="text-caption text-muted-foreground">
                Secondary actions of equal standing.
              </span>
            </Row>
            <Row label="ghost">
              <Button variant="ghost">Cancel</Button>
              <Button variant="ghost" disabled>
                Cancel
              </Button>
              <span className="text-caption text-muted-foreground">
                Dismissal, and toolbar controls that must not compete.
              </span>
            </Row>
            <Row label="destructive">
              <Button variant="destructive">Reject</Button>
              <Button variant="destructive" disabled>
                Reject
              </Button>
              <span className="text-caption text-muted-foreground">
                Irreversible. Always behind a confirmation that previews the effect.
              </span>
            </Row>
          </div>
        </Specimen>

        <Specimen label="Sizes" token="<Button size>">
          <div className="flex flex-col">
            <Row label="lg">
              <Button size="lg">Issue certificate</Button>
            </Row>
            <Row label="default">
              <Button>Issue certificate</Button>
            </Row>
            <Row label="sm">
              <Button size="sm">Issue certificate</Button>
              <span className="text-caption text-muted-foreground">
                Toolbars and row actions only.
              </span>
            </Row>
            <Row label="icon">
              <Button size="icon" aria-label="More actions">
                <span aria-hidden="true">···</span>
              </Button>
              <span className="text-caption text-muted-foreground">
                Always needs an <code className="font-mono text-caption">aria-label</code>.
              </span>
            </Row>
          </div>
        </Specimen>

        <Pending>
          Button heights are hardcoded (<code className="font-mono text-caption">h-11</code>,{' '}
          <code className="font-mono text-caption">h-9</code>,{' '}
          <code className="font-mono text-caption">h-12</code>) rather than reading{' '}
          <code className="font-mono text-caption">h-control</code>, so they ignore the density
          preference.
        </Pending>
      </Section>

      {/* ── Fields ──────────────────────────────────────────────────────── */}
      <Section
        id="fields"
        title="Fields"
        intro="A form that reacts is what separates a mature product from a data-entry screen. On a financial form the difference between 'not yet valid' and 'checked and correct' is the difference between confidence and a phone call."
      >
        <Specimen label="What exists today" token="<FormField> + <Input>">
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField
              htmlFor="ds-ref"
              label="Certificate reference"
              hint="The placeholder shows the format, never repeats the label."
            >
              <Input id="ds-ref" placeholder="e.g. IPC-2026-0042" />
            </FormField>

            <FormField
              htmlFor="ds-qty"
              label="Certified quantity"
              required
              hint="Quantities carry 3 decimal places; money carries 2."
            >
              <Input id="ds-qty" defaultValue="1240.500" inputMode="decimal" />
            </FormField>

            <FormField
              htmlFor="ds-cum"
              label="Cumulative claimed"
              required
              error="Exceeds BOQ quantity by 300.000. Remaining: 2 500.000"
            >
              <Input id="ds-cum" defaultValue="2800.000" inputMode="decimal" />
            </FormField>

            <FormField htmlFor="ds-cur" label="Currency" required>
              <Select id="ds-cur" defaultValue="SOS">
                <option value="SOS">SOS — Somali Shilling</option>
                <option value="USD">USD — US Dollar</option>
              </Select>
            </FormField>

            <FormField
              htmlFor="ds-rate"
              label="Unit rate"
              hint="Locked — taken from the BOQ node."
              className="sm:col-span-1"
            >
              <Input id="ds-rate" defaultValue="185.00 SOS" readOnly />
            </FormField>

            <FormField
              htmlFor="ds-var"
              label="Variance reason"
              hint="Becomes required when the certified and claimed figures diverge."
              className="sm:col-span-1"
            >
              <Textarea id="ds-var" placeholder="Explain the difference…" />
            </FormField>
          </div>
        </Specimen>

        <Rule>
          An error names the fix, not the failure. Not &ldquo;invalid quantity&rdquo; but
          &ldquo;exceeds BOQ quantity by 300.000, remaining 2 500.000&rdquo; — the number the
          user needs is in the message, so they never have to go and find it. The read-only
          field above is the other half of the same rule: a value the system owns looks owned,
          and says who owns it.
        </Rule>

        <Pending>
          Four states from the specification have no implementation:{' '}
          <strong className="font-semibold">success</strong> (green border, tick, &ldquo;Verified
          — matches registered supplier&rdquo;), <strong className="font-semibold">checking</strong>{' '}
          for async validation, a <strong className="font-semibold">character counter</strong>,
          and <strong className="font-semibold">icon or prefix slots</strong>. Phase 2 adds them
          to <code className="font-mono text-caption">Input</code>,{' '}
          <code className="font-mono text-caption">Select</code> and{' '}
          <code className="font-mono text-caption">Textarea</code> together, because a field set
          where only one control can show success is worse than one where none can.
        </Pending>
      </Section>

      {/* ── Form composition ────────────────────────────────────────────── */}
      <Section
        id="forms"
        title="Form composition"
        intro="Long forms group into named sections. A section is a question the user can answer in one sitting — not an arbitrary slice of the schema."
      >
        <Specimen label="FormSection — card and plain" token="<FormSection variant>">
          <div className="flex flex-col gap-6">
            <FormSection
              title="Identity"
              description="How this supplier appears on every purchase order, bill and payment."
            >
              <div className="grid gap-5 sm:grid-cols-2">
                <FormField htmlFor="ds-sup" label="Supplier name" required>
                  <Input id="ds-sup" placeholder="Registered legal name" />
                </FormField>
                <FormField
                  htmlFor="ds-tax"
                  label="Tax number"
                  hint="Used on every bill posted against this supplier."
                >
                  <Input id="ds-tax" placeholder="SO-0000-000-0" />
                </FormField>
              </div>
            </FormSection>

            <FormSection
              variant="plain"
              title="Payment terms"
              description="Applied by default to new bills. Editable per bill."
            >
              <div className="grid gap-5 sm:grid-cols-2">
                <FormField htmlFor="ds-terms" label="Terms">
                  <Select id="ds-terms" defaultValue="30">
                    <option value="0">Due on receipt</option>
                    <option value="30">Net 30</option>
                    <option value="60">Net 60</option>
                  </Select>
                </FormField>
                <FormField htmlFor="ds-bank" label="Default bank account">
                  <Select id="ds-bank" defaultValue="">
                    <option value="">Select an account…</option>
                    <option value="1">Salaam Bank · Operations</option>
                  </Select>
                </FormField>
              </div>
            </FormSection>
          </div>
        </Specimen>

        <Specimen label="Label — standalone" token="<Label>">
          <div className="flex flex-col gap-2">
            <Label htmlFor="ds-search">Search bills</Label>
            <Input id="ds-search" placeholder="Reference, supplier or amount" className="max-w-sm" />
            <p className="mt-1 text-caption text-muted-foreground">
              Use <code className="font-mono text-caption">FormField</code> instead wherever
              there is a hint or an error — it wires{' '}
              <code className="font-mono text-caption">aria-describedby</code>,{' '}
              <code className="font-mono text-caption">aria-invalid</code> and{' '}
              <code className="font-mono text-caption">aria-required</code> through context so
              no caller has to remember them.
            </p>
          </div>
        </Specimen>
      </Section>
    </>
  );
}
