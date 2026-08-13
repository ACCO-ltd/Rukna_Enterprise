'use client';

import { useState } from 'react';
import {
  Button,
  DateInput,
  FormField,
  FormSection,
  Input,
  Label,
  Select,
  Textarea,
  useToast,
} from '@erp/ui';

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
  const [notes, setNotes] = useState('');

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

        <Specimen
          label="The rest of the state matrix"
          token="success · checking · counter · slots"
          note="Success is only worth showing where the check told the user something they could not have known themselves — a lookup resolved, a figure reconciled. A tick on every field that merely passed a required-check is noise, and it devalues the tick on the field where it means something."
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField
              htmlFor="ds-tax2"
              label="Supplier tax number"
              success="Verified — matches registered supplier"
            >
              <Input id="ds-tax2" defaultValue="SO-0114-882-3" />
            </FormField>

            <FormField
              htmlFor="ds-code2"
              label="Contract number"
              checking
              checkingLabel="Checking this number is not already in use…"
            >
              <Input id="ds-code2" defaultValue="ACCO-2026-0184" />
            </FormField>

            <FormField
              htmlFor="ds-notes2"
              label="Variance reason"
              requirementNote="optional until certified ≠ claimed"
              hint="Explain any difference between the certified and claimed figures."
              counter={{ value: notes.length, max: 120 }}
              error={notes.length > 120 ? 'Shorten this to 120 characters or fewer.' : undefined}
            >
              <Textarea
                id="ds-notes2"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Type past 120 characters to see the counter turn."
              />
            </FormField>

            <div className="flex flex-col gap-5">
              <FormField htmlFor="ds-amt2" label="Certified amount" hint="Start and end slots.">
                <Input
                  id="ds-amt2"
                  defaultValue="486 200.00"
                  className="text-end tabular-nums"
                  startSlot={<span className="text-caption font-semibold">SOS</span>}
                  endSlot={<span className="text-caption">.00</span>}
                />
              </FormField>

              <FormField
                htmlFor="ds-date2"
                label="Accounting date"
                required
                hint="Must fall inside an open period — pass min/max so the picker cannot offer one that is closed."
              >
                <DateInput id="ds-date2" defaultValue="2026-08-13" min="2026-08-01" max="2026-08-31" />
              </FormField>
            </div>
          </div>
        </Specimen>

        <Rule>
          <code className="font-mono text-caption">DateInput</code> is a styled native{' '}
          <code className="font-mono text-caption">&lt;input type=&quot;date&quot;&gt;</code>, for
          the same reason <code className="font-mono text-caption">Select</code> is a native{' '}
          <code className="font-mono text-caption">&lt;select&gt;</code> — and a stronger one. A
          custom calendar has to decide what a week looks like, which calendar system to show,
          and how to lay a month grid out right-to-left. This product is bilingual Arabic and
          runs on site phones. What was actually broken was never the input, it was that every
          date field was an <em>unstyled</em> one sitting next to inputs that honoured every
          token.
        </Rule>
      </Section>

      {/* ── Toast ───────────────────────────────────────────────────────── */}
      <Section
        id="toast"
        title="Toast"
        intro="The product had no way to say that anything had succeeded. A certificate was issued, a journal posted, a payment reversed — and the screen simply changed. Press these; they are live."
      >
        <ToastSpecimen />

        <Rule>
          Three rules make a toast trustworthy. <strong>A failure never disappears on a
          timer</strong> — a success can auto-dismiss because the user watched it happen, but a
          message explaining why a journal did not post must still be there when they look back,
          so the error tone forces <code className="font-mono text-caption">duration: null</code>.{' '}
          <strong>Errors announce assertively, everything else politely</strong> — two separate
          live regions, because <code className="font-mono text-caption">aria-live</code> is a
          property of the region, not the message. <strong>Hovering or focusing pauses the
          timer</strong>, so nothing vanishes mid-sentence or while someone tabs to its action.
        </Rule>
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

// ─── Toast specimen ──────────────────────────────────────────────────────────

/**
 * Separate component so `useToast` is called under the provider mounted in the root
 * layout — and so the gallery proves the provider is actually wired, not just exported.
 */
function ToastSpecimen() {
  const { toast } = useToast();

  return (
    <Specimen label="Toast — live" token="useToast()">
      <div className="flex flex-wrap gap-3">
        <Button
          onClick={() =>
            toast({
              tone: 'success',
              title: 'Certificate IPC-2026-0042 issued',
              description: 'Net certified 155 572.00 SOS. The application is now certified.',
              action: { label: 'View certificate', onClick: () => undefined },
            })
          }
        >
          Success, with an action
        </Button>

        <Button
          variant="destructive"
          onClick={() =>
            toast({
              tone: 'error',
              title: 'Journal could not be posted',
              description:
                'Period 2026-08 is closed. Reopen the period, or change the accounting date to one inside an open period.',
              action: { label: 'Open fiscal periods', onClick: () => undefined },
            })
          }
        >
          Failure — will not self-dismiss
        </Button>

        <Button
          variant="outline"
          onClick={() =>
            toast({
              tone: 'warning',
              title: 'Committed figures may be overstated',
              description: 'Cancelling a purchase order does not reverse its commitment.',
            })
          }
        >
          Warning
        </Button>

        <Button
          variant="ghost"
          onClick={() => toast({ tone: 'info', title: 'Draft saved' })}
        >
          Info, bare
        </Button>
      </div>
      <p className="mt-4 text-caption leading-5 text-muted-foreground">
        Raise the success and the failure together, then hover the failure: its timer never
        started, and hovering the success stops its own. Switch the direction toggle to RTL and
        the stack moves to the other corner — the viewport is positioned with logical insets.
      </p>
    </Specimen>
  );
}
