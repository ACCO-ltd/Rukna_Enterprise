'use client';

import { useState } from 'react';
import {
  Button,
  Combobox,
  type ComboboxOption,
  DatePicker,
  DateRangePicker,
  FilterBar,
  FilterField,
  FormField,
  FormSection,
  Input,
  Label,
  RadioGroup,
  SectionHeader,
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
                <DatePickerSpecimen id="ds-date2" initial="2026-08-13" min="2026-08-01" max="2026-08-31" />
              </FormField>
            </div>
          </div>
        </Specimen>

        <Rule>
          <code className="font-mono text-caption">DatePicker</code> is a trigger and a calendar
          in a popover, replacing the styled native{' '}
          <code className="font-mono text-caption">&lt;input type=&quot;date&quot;&gt;</code> that
          stood here before. The native control was typeable and gave a phone its own picker, and
          both were real losses — but the calendar it opened was the browser&apos;s: unstyled,
          blind to the dark theme, different in every browser, and unable to express a constraint
          finer than <code className="font-mono text-caption">min</code>/
          <code className="font-mono text-caption">max</code>. That last one is what decided it. A
          posting date has to fall in a period that is still open, and closed periods are not a
          range — they have holes. Pass{' '}
          <code className="font-mono text-caption">isDateDisabled</code> and the calendar refuses
          those days outright, instead of the server rejecting the form afterwards.
        </Rule>

        <Specimen label="DateRangePicker" token="<DateRangePicker>">
          <div className="max-w-sm">
            <Label htmlFor="ds-range" className="mb-1.5 block text-body-sm font-medium text-foreground">
              Date range
            </Label>
            <DateRangePickerSpecimen id="ds-range" />
          </div>
        </Specimen>

        <Rule>
          One calendar in <code className="font-mono text-caption">react-day-picker</code>&rsquo;s
          own range mode, not two <code className="font-mono text-caption">DatePicker</code>s
          bolted together — <code className="font-mono text-caption">Calendar</code> already
          carries <code className="font-mono text-caption">range_start</code>/
          <code className="font-mono text-caption">range_end</code>/
          <code className="font-mono text-caption">range_middle</code> styling that sat unused
          until now. Closes on the second click, not the first — react-day-picker sets{' '}
          <code className="font-mono text-caption">to = from</code> on the first click, so
          &ldquo;a click happened&rdquo; cannot be the close condition.
        </Rule>

        <Specimen label="RadioGroup — inline and card" token="<RadioGroup variant>">
          <RadioGroupSpecimen />
        </Specimen>

        <Rule>
          <code className="font-mono text-caption">variant=&quot;card&quot;</code> is for a
          choice that needs deciding, not just picking — the description is part of the
          decision. It still keeps the description out of the radio&rsquo;s accessible name
          (<code className="font-mono text-caption">aria-describedby</code>, not nested text) —
          the same rule <code className="font-mono text-caption">CheckboxField</code> follows, so
          a screen reader announces the label once and the description once, not the two run
          together.
        </Rule>

        <Specimen
          label="Combobox — grouped, with a loading state"
          token="<Combobox> · group · icon · caption · meta · loading"
        >
          <ComboboxSpecimen />
        </Specimen>

        <Rule>
          Grouping goes by array order — put every option for one group together, in the order
          the section should read. <code className="font-mono text-caption">loading</code> swaps
          the list for a spinner without closing the panel or losing what was typed, for a
          server-driven search where <code className="font-mono text-caption">options</code>
          hasn&rsquo;t caught up yet.
        </Rule>

        <Specimen label="FilterBar" token="<FilterBar> · <FilterField grow>">
          <FilterBarSpecimen />
        </Specimen>

        <Rule>
          <code className="font-mono text-caption">grow</code> is for the field people reach for
          first — the search box — not a general-purpose sizing knob. Every other field shares
          one <code className="font-mono text-caption">flex-1</code>: they grow evenly and wrap
          together at 375px, rather than each field guessing its own width the way five screens
          independently did before this existed.
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

        <Specimen label="FormSection — numbered" token="<FormSection step>">
          <div className="flex flex-col gap-6">
            <FormSection step={1} title="Procurement Method" description="Select the most appropriate procurement method for this purchase.">
              <p className="text-caption text-muted-foreground">
                A numbered section is for a form that is itself a short sequence of decisions —
                not a label on every section of a long one.
              </p>
            </FormSection>
            <FormSection step={2} variant="plain" title="Tax Treatment" description="Select how tax should be applied to this purchase.">
              <p className="text-caption text-muted-foreground">Plain variant, numbered.</p>
            </FormSection>
          </div>
        </Specimen>

        <Specimen label="SectionHeader — with a subtitle" token="<SectionHeader subtitle>">
          <div className="flex flex-col gap-6">
            <SectionHeader title="Approval status" />
            <SectionHeader
              title="Requisition details"
              subtitle="PR-2026-0148 · Submitted 22 Sep 2026 by Ahmed Ali"
            >
              <Button variant="ghost" size="sm">
                Edit
              </Button>
            </SectionHeader>
          </div>
          <p className="mt-4 text-caption leading-5 text-muted-foreground">
            <code className="font-mono text-caption">subtitle</code> is optional — most sections
            need only the label. Reach for it when the section is a specific record, not a
            category of fields.
          </p>
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

/**
 * The gallery's date specimen.
 *
 * `DatePicker` is controlled — it has no `defaultValue`, because a date the user picks has to
 * round-trip through the caller's own state to be submitted. The gallery therefore has to hold
 * that state like any real screen does, which is itself the thing worth demonstrating.
 */
/**
 * `RadioGroup` is controlled, same reason as `DatePicker` below: a choice the user makes has
 * to round-trip through the caller's own state, so the gallery holds it like any real screen.
 */
function RadioGroupSpecimen() {
  const [taxTreatment, setTaxTreatment] = useState('inclusive');
  const [method, setMethod] = useState('rfq');

  return (
    <div className="flex flex-col gap-8">
      <div>
        <p className="mb-3 text-micro font-semibold uppercase text-muted-foreground">
          variant=&quot;inline&quot; (default)
        </p>
        <RadioGroup
          label="Tax treatment"
          name="ds-tax-treatment"
          value={taxTreatment}
          onChange={setTaxTreatment}
          options={[
            { value: 'inclusive', label: 'Inclusive' },
            { value: 'exclusive', label: 'Exclusive' },
            { value: 'exempt', label: 'Exempt' },
          ]}
        />
      </div>
      <div>
        <p className="mb-3 text-micro font-semibold uppercase text-muted-foreground">
          variant=&quot;card&quot;
        </p>
        <RadioGroup
          label="Procurement method"
          name="ds-procurement-method"
          value={method}
          onChange={setMethod}
          variant="card"
          orientation="vertical"
          options={[
            {
              value: 'direct',
              label: 'Direct Purchase',
              description: 'Low-value purchase from an approved supplier.',
            },
            {
              value: 'rfq',
              label: 'Request for Quotation',
              description: 'Collect quotations from multiple suppliers.',
            },
            {
              value: 'tender',
              label: 'Tender',
              description: 'Formal process requiring tender evaluation.',
            },
          ]}
        />
      </div>
    </div>
  );
}

const SUPPLIER_OPTIONS: ComboboxOption[] = [
  { value: 'sup-48', label: 'Al Noor Building Materials', group: 'Top Matches', hint: 'SUP-0048', meta: '$12,840' },
  { value: 'sup-213', label: 'Al Noor Trading Co.', group: 'Top Matches', hint: 'SUP-0213', meta: '$5,230' },
  { value: 'sup-176', label: 'Al Noor Construction Supplies', group: 'Recent Suppliers', hint: 'SUP-0176', meta: '$0' },
  { value: 'sup-91', label: 'Al Noor Infrastructure LLC', group: 'Recent Suppliers', hint: 'SUP-0091', meta: '$28,450' },
];

/**
 * Grouping is caller-ordered (`SUPPLIER_OPTIONS` puts every "Top Matches" row before every
 * "Recent Suppliers" row), and the group label carries its own count rather than the component
 * recomputing one — a filtered search legitimately changes how many rows are left in a group.
 */
function ComboboxSpecimen() {
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <Combobox
        id="ds-supplier"
        value={value}
        onChange={setValue}
        options={SUPPLIER_OPTIONS}
        placeholder="Select a supplier"
        searchPlaceholder="Search suppliers"
        emptyLabel="No suppliers found"
        footerAction={{ label: 'Create new supplier "al noor"', onSelect: () => undefined }}
        loading={loading}
        loadingLabel="Searching suppliers…"
      />
      <label className="flex items-center gap-2 text-caption text-muted-foreground">
        <input
          type="checkbox"
          checked={loading}
          onChange={(event) => setLoading(event.target.checked)}
          className="h-4 w-4 accent-brand-primary"
        />
        Simulate loading (server-driven search)
      </label>
    </div>
  );
}

function DateRangePickerSpecimen({ id }: { id: string }) {
  const [range, setRange] = useState({ from: '2026-04-01', to: '2026-04-30' });
  return (
    <DateRangePicker
      id={id}
      fromValue={range.from}
      toValue={range.to}
      onChange={setRange}
      clearLabel="Clear"
    />
  );
}

/**
 * A representative "Purchase Requisitions" filter row — search grows, three Selects share the
 * remaining width evenly, and "Clear filters" appears only once something narrows the list.
 */
function FilterBarSpecimen() {
  const [search, setSearch] = useState('');
  const [project, setProject] = useState('');
  const [status, setStatus] = useState('');
  const hasFilters = search !== '' || project !== '' || status !== '';

  return (
    <FilterBar
      actions={
        hasFilters ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch('');
              setProject('');
              setStatus('');
            }}
          >
            Clear filters
          </Button>
        ) : null
      }
    >
      <FilterField id="ds-fb-search" label="Search" hideLabel grow>
        <Input
          id="ds-fb-search"
          type="search"
          placeholder="Search PR number, description or vendor…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </FilterField>
      <FilterField id="ds-fb-project" label="Project">
        <Select id="ds-fb-project" value={project} onChange={setProject}>
          <option value="">All projects</option>
          <option value="riverside">Riverside Commercial Tower</option>
          <option value="palm">Palm Residence</option>
        </Select>
      </FilterField>
      <FilterField id="ds-fb-status" label="Status">
        <Select id="ds-fb-status" value={status} onChange={setStatus}>
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="pending">Pending approval</option>
          <option value="approved">Approved</option>
        </Select>
      </FilterField>
    </FilterBar>
  );
}

function DatePickerSpecimen({
  id,
  initial,
  min,
  max,
}: {
  id: string;
  initial: string;
  min?: string;
  max?: string;
}) {
  const [value, setValue] = useState(initial);
  return <DatePicker id={id} value={value} onChange={setValue} min={min} max={max} />;
}
