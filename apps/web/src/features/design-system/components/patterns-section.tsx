'use client';

import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetTitle,
  SheetTrigger,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@erp/ui';
import { FileX, Receipt } from '@phosphor-icons/react';

import { EmptyState } from '@/components/empty-state';
import { ProgressStepper, type Step } from '@/components/progress-stepper';
import { SetupChecklist } from '@/components/setup-checklist';
import { StatusBadge } from '@/components/status-badge';

import { Pending, Row, Rule, Section, Specimen } from './gallery-chrome';

// ─── Badge tone vocabulary ────────────────────────────────────────────────────

const TONES = [
  { tone: 'neutral', label: 'Draft', meaning: 'Not started, or finished and inert' },
  { tone: 'info', label: 'Approved', meaning: 'Progressing normally' },
  { tone: 'live', label: 'Active', meaning: 'In force right now' },
  { tone: 'accent', label: 'Mobilizing', meaning: 'Transitional — someone must move it along' },
  { tone: 'warning', label: 'Closeout', meaning: 'Needs attention, or winding down' },
  { tone: 'danger', label: 'Cancelled', meaning: 'Stopped short of its normal end' },
  { tone: 'historical', label: 'Superseded', meaning: 'Replaced, kept for the record' },
] as const;

/** One real status per semantic token, so the mapping can be checked by eye. */
const STATUSES = [
  'DRAFT',
  'PENDING_INTERNAL_APPROVAL',
  'ACTIVE',
  'PRACTICAL_COMPLETION',
  'REJECTED',
  'SUPERSEDED',
] as const;

const STEPS: Step[] = [
  { id: 'application', label: 'Application', status: 'complete' },
  { id: 'quantities', label: 'Quantities', status: 'complete' },
  { id: 'deductions', label: 'Deductions', status: 'current' },
  { id: 'review', label: 'Review & issue', status: 'upcoming' },
];

const STEPS_ERROR: Step[] = [
  { id: 'application', label: 'Application', status: 'complete' },
  { id: 'quantities', label: 'Quantities', status: 'error', description: '2 lines over BOQ' },
  { id: 'deductions', label: 'Deductions', status: 'upcoming' },
  { id: 'review', label: 'Review & issue', status: 'upcoming' },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function PatternsSection() {
  return (
    <>
      {/* ── Status ──────────────────────────────────────────────────────── */}
      <Section
        id="status"
        title="Status"
        intro="Every status machine in the platform — projects, contracts, applications, certificates, bills, payments, guarantees — draws from one tone vocabulary. Tones describe where a record sits in its lifecycle, never a palette."
      >
        <Specimen label="Badge tones" token="<Badge tone>">
          <div className="flex flex-col">
            {TONES.map((t) => (
              <Row key={t.tone} label={t.tone}>
                <Badge tone={t.tone}>{t.label}</Badge>
                <span className="text-caption text-muted-foreground">{t.meaning}</span>
              </Row>
            ))}
          </div>
        </Specimen>

        <Specimen
          label="StatusBadge — the mapping from an API status"
          token="<StatusBadge status>"
          note="Pass the raw status key straight from the API. formatStatus() in lib/format.ts is the single source of truth for which colour a status gets, so no feature module ever maps a status string to a colour itself."
        >
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <StatusBadge key={s} status={s} />
            ))}
          </div>
          <p className="mt-4 text-caption text-muted-foreground">
            Unknown keys fall back to neutral and are humanised, so a new backend status renders
            legibly before anyone has wired a translation for it:
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <StatusBadge status="AWAITING_VARIATION_APPROVAL" />
          </div>
        </Specimen>

        <Rule>
          Colour carries emphasis, never meaning on its own. The label is always present and
          every status carries a glyph, so a badge stays readable for a colour-blind user, in a
          printed submittal, and on the contrast a site-office monitor actually manages.
        </Rule>
      </Section>

      {/* ── Data ────────────────────────────────────────────────────────── */}
      <Section
        id="data"
        title="Tables"
        intro="Table primitives, not a data grid. Sorting, paging and selection live in PlatformDataGrid above these, where they can be tested without rendering."
      >
        <Specimen label="Table — supplier bills" token="<Table> inside <TableScroll>" bare>
          <TableScroll className="rounded-none border-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bill</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead numeric>Amount</TableHead>
                  <TableHead numeric>Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-mono text-caption">BILL-2026-0311</TableCell>
                  <TableCell>Horyaal Building Materials</TableCell>
                  <TableCell>
                    <StatusBadge status="APPROVED" />
                  </TableCell>
                  <TableCell numeric>486 200.00</TableCell>
                  <TableCell numeric>486 200.00</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono text-caption">BILL-2026-0310</TableCell>
                  <TableCell>Berbera Freight &amp; Logistics</TableCell>
                  <TableCell>
                    <StatusBadge status="PAID" />
                  </TableCell>
                  <TableCell numeric>62 400.00</TableCell>
                  <TableCell numeric>0.00</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono text-caption">BILL-2026-0309</TableCell>
                  <TableCell>Sheikh Steel Trading</TableCell>
                  <TableCell>
                    <StatusBadge status="PARTIALLY_PAID" />
                  </TableCell>
                  <TableCell numeric>1 204 750.00</TableCell>
                  <TableCell numeric>300 000.00</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableScroll>
        </Specimen>

        <Specimen label="TableEmpty" token="<TableEmpty colSpan>" bare>
          <TableScroll className="rounded-none border-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bill</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead numeric>Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableEmpty colSpan={3}>No bills match these filters.</TableEmpty>
              </TableBody>
            </Table>
          </TableScroll>
        </Specimen>

        <Rule>
          <code className="font-mono text-caption">numeric</code> on a head and cell
          right-aligns and applies tabular figures, so money stacks on the decimal point. It
          uses logical <code className="font-mono text-caption">text-end</code>, which is still
          the end of the line in Arabic — where a number belongs in both directions. Every
          table must be wrapped in{' '}
          <code className="font-mono text-caption">TableScroll</code>: wide content scrolls
          inside its own container and the page body never scrolls sideways.
        </Rule>

        <Pending>
          The grid has no <strong className="font-semibold">saved-view tabs</strong> and no{' '}
          <strong className="font-semibold">standard row-action column</strong>, and no list
          footer totals the money in view. A financial list that does not add up its own column
          pushes the reader into a spreadsheet.
        </Pending>
      </Section>

      {/* ── Feedback ────────────────────────────────────────────────────── */}
      <Section
        id="feedback"
        title="Feedback"
        intro="A mutation that changes state must be acknowledged where the user acted: inline for a field, a toast for a completed action, a dialog only when the action is irreversible and needs a preview first."
      >
        <Specimen label="Alert" token="<Alert variant>">
          <div className="flex flex-col gap-3">
            <Alert
              variant="error"
              title="Journal could not be posted"
              messages={[
                'Period 2026-08 is closed. Reopen the period or change the accounting date.',
              ]}
            />
            <Alert
              variant="warning"
              title="Committed figures on this page may be inaccurate"
              messages={[
                'Cancelling a purchase order writes no reversal to the commitment ledger.',
                'Superseding a revision over-reverses the previous commitment.',
              ]}
            />
            <Alert variant="success" messages={['Certificate IPC-2026-0042 issued.']} />
            <Alert
              variant="info"
              messages={['Retention and advance recovery are calculated from the contract.']}
            />
          </div>
          <p className="mt-4 text-caption leading-5 text-muted-foreground">
            <code className="font-mono text-caption">messages</code> takes an array because the
            API returns <code className="font-mono text-caption">error.message</code> as an
            array for 400 validation failures — one entry per failed constraint. Concatenating
            them produces one unreadable line.
          </p>
        </Specimen>

        <Specimen label="EmptyState" token="<EmptyState variant>">
          <div className="flex flex-col gap-6">
            <EmptyState
              icon={<Receipt size={24} aria-hidden="true" />}
              title="No supplier bills yet"
              description="Bills appear here once a supplier invoice is recorded against a purchase order or entered directly."
              action={<Button>New bill</Button>}
            />
            <EmptyState
              icon={<FileX size={24} aria-hidden="true" />}
              title="No bills match these filters"
              description="Three bills exist outside the current period and supplier filter."
              action={<Button variant="outline">Clear filters</Button>}
              variant="inline"
            />
          </div>
        </Specimen>

        <Rule>
          There are five distinct empty states and they are not interchangeable: nothing exists
          yet (offer the action that creates the first one), nothing matches the filters (offer
          to clear them), the request failed (offer retry), permission denied (say who to ask),
          and not found. Reaching for the same copy for all five is what makes a product feel
          thin.
        </Rule>

        <Pending>
          There is no <strong className="font-semibold">toast</strong> and no{' '}
          <strong className="font-semibold">skeleton</strong> primitive. A successful post,
          approval or reversal is currently silent, and 50 files hand-roll their own{' '}
          <code className="font-mono text-caption">animate-pulse</code> block. Both are the
          first two items in Phase 2 — highest value per line of code in the whole plan.
        </Pending>
      </Section>

      {/* ── Flow ────────────────────────────────────────────────────────── */}
      <Section
        id="flow"
        title="Progress and guidance"
        intro="What makes a long flow feel effortless is not the dots. It is that a completed step collapses to a labelled row the user can still see, and go back to without unwinding the rest."
      >
        <Specimen label="ProgressStepper" token="<ProgressStepper steps>">
          <div className="flex flex-col gap-8">
            <div>
              <p className="mb-3 text-micro font-semibold uppercase text-muted-foreground">
                In progress
              </p>
              <ProgressStepper steps={STEPS} />
            </div>
            <div>
              <p className="mb-3 text-micro font-semibold uppercase text-muted-foreground">
                With a step in error
              </p>
              <ProgressStepper steps={STEPS_ERROR} />
            </div>
          </div>
        </Specimen>

        <Specimen label="SetupChecklist" token="<SetupChecklist items>">
          <SetupChecklist
            title="Project setup"
            progress="2 of 4 complete"
            items={[
              { id: 'details', label: 'Project details', status: 'complete' },
              { id: 'boq', label: 'Bill of quantities', status: 'complete' },
              {
                id: 'contract',
                label: 'Client contract',
                status: 'blocked',
                blockedReason: 'Requires a baselined BOQ version.',
              },
              {
                id: 'members',
                label: 'Project team',
                status: 'optional',
                description: 'Assign a project manager and quantity surveyor.',
                action: (
                  <Button variant="outline" size="sm">
                    Assign
                  </Button>
                ),
              },
            ]}
          />
        </Specimen>

        <Specimen label="Tabs" token="<Tabs>">
          <Tabs defaultValue="lines">
            <TabsList>
              <TabsTrigger value="lines">Lines</TabsTrigger>
              <TabsTrigger value="matching">Matching</TabsTrigger>
              <TabsTrigger value="journal">Journal</TabsTrigger>
              <TabsTrigger value="payments">Payments</TabsTrigger>
            </TabsList>
            <TabsContent value="lines">
              <p className="text-body text-muted-foreground">
                A tab set is the record&rsquo;s own structure — never navigation dressed as tabs.
                If a panel has its own URL and its own permissions, it is a route.
              </p>
            </TabsContent>
            <TabsContent value="matching">
              <p className="text-body text-muted-foreground">
                Radix reverses arrow-key direction under{' '}
                <code className="font-mono text-caption">dir=&quot;rtl&quot;</code>: in Arabic,
                Left moves to the next tab. Switch the direction toggle above and try it.
              </p>
            </TabsContent>
            <TabsContent value="journal">
              <p className="text-body text-muted-foreground">Journal panel.</p>
            </TabsContent>
            <TabsContent value="payments">
              <p className="text-body text-muted-foreground">Payments panel.</p>
            </TabsContent>
          </Tabs>
        </Specimen>

        <Pending>
          <code className="font-mono text-caption">ProgressStepper</code> only draws progress —
          it owns no state, no gate between steps, no draft. The two wizards in the product
          (<code className="font-mono text-caption">ipc-wizard</code>,{' '}
          <code className="font-mono text-caption">opening-balance-wizard</code>) each built
          their own machinery. Phase 2 adds a{' '}
          <code className="font-mono text-caption">Wizard</code> shell that owns the step
          machine, per-step validation, the confirmed-summary rows, draft persistence, the
          review step and the terminal success screen — then refits both onto it.
        </Pending>
      </Section>

      {/* ── Overlays ────────────────────────────────────────────────────── */}
      <Section
        id="overlays"
        title="Overlays"
        intro="Open each one and try Escape, Tab and the direction toggle. Radix supplies the focus trap, the scroll lock and the return-focus behaviour; these wrappers supply only the surface."
      >
        <Specimen label="Dialog, Sheet, DropdownMenu" token="<Dialog> · <Sheet> · <DropdownMenu>">
          <div className="flex flex-wrap gap-3">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="destructive">Execute contract</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogTitle>Execute this contract?</DialogTitle>
                <DialogDescription>
                  The client name and tax number will be copied onto the contract and locked
                  permanently. Later corrections to the client record will not follow.
                </DialogDescription>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="ghost">Cancel</Button>
                  </DialogClose>
                  <DialogClose asChild>
                    <Button variant="destructive">Execute contract</Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline">Filters</Button>
              </SheetTrigger>
              <SheetContent>
                <SheetTitle>Filter bills</SheetTitle>
                <SheetDescription>
                  A sheet is for a secondary task alongside the page. A dialog is for a decision
                  that blocks it.
                </SheetDescription>
                <SheetFooter>
                  <SheetClose asChild>
                    <Button variant="ghost">Reset</Button>
                  </SheetClose>
                  <SheetClose asChild>
                    <Button>Apply</Button>
                  </SheetClose>
                </SheetFooter>
              </SheetContent>
            </Sheet>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="More actions">
                  <span aria-hidden="true">···</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem>Duplicate bill</DropdownMenuItem>
                <DropdownMenuItem>Download PDF</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem>Reverse posting</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </Specimen>

        <Rule>
          A confirmation dialog states the exact effect, in the user&rsquo;s terms, before it
          happens — &ldquo;the client name and tax number will be locked permanently&rdquo;, not
          &ldquo;are you sure?&rdquo;. The confirm button repeats the verb from the trigger, so
          nobody has to re-read the title to know what the button does.
        </Rule>
      </Section>
    </>
  );
}
