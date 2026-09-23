'use client';

import { Alert, Avatar, Badge, Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, Checkbox, Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle, DialogTrigger, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, EmptyState, Meter, Progress, Sheet, SheetBody, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger, SkeletonForm, SkeletonRecord, SkeletonTable, Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow, TableScroll, Tabs, TabsContent, TabsList, TabsTrigger, Tooltip, TooltipContent, TooltipTrigger } from '@erp/ui';
import { FileX, Receipt, Warning } from '@phosphor-icons/react';

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
      {/* ── Containers ──────────────────────────────────────────────────── */}
      <Section
        id="containers"
        title="Containers"
        intro="The byte-identical rounded-xl border border-border bg-surface shadow-panel shell that 59 screens were hand-writing, registered once. Reach for RecordPanel (Record layout, below) for a titled record/detail panel with icon + action + meta — Card is for everything else a screen groups visually."
      >
        <Specimen label="Card" token="<Card> · <CardHeader> · <CardContent> · <CardFooter>">
          <Card className="max-w-sm">
            <CardHeader>
              <div>
                <CardTitle>Purchase Requisitions</CardTitle>
                <CardDescription>Internal requests for goods, materials, and services.</CardDescription>
              </div>
              <Button size="sm">New</Button>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between border-t border-border pt-4 text-body-sm">
                <span className="text-muted-foreground">Open</span>
                <span className="font-semibold text-foreground">24</span>
              </div>
              <div className="flex items-center justify-between border-t border-border py-3 text-body-sm">
                <span className="text-muted-foreground">Pending approval</span>
                <span className="font-semibold text-foreground">8</span>
              </div>
            </CardContent>
            <CardFooter>
              <Button variant="outline" size="sm">
                View all
              </Button>
            </CardFooter>
          </Card>
        </Specimen>

        <Specimen label="Avatar" token="<Avatar name size>">
          <div className="flex flex-wrap items-center gap-4">
            <Avatar name="Omar Khan" size="sm" />
            <Avatar name="Omar Khan" />
            <Avatar name="Omar Khan" size="lg" />
            <Avatar name="Priya Shah" />
            <span className="ms-2 flex items-center gap-2 text-body-sm text-muted-foreground">
              <Avatar name="John Dvers" size="sm" />
              John Dvers · Project Manager
            </span>
          </div>
        </Specimen>

        <Rule>
          <code className="font-mono text-caption">Avatar</code> is decorative by default — every
          real usage sits beside the person&rsquo;s visible name, which already carries the
          accessible name.
        </Rule>
      </Section>

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

        <Specimen
          label="Recipe — permission matrix"
          token="<Table> + <Checkbox>, no new component"
          note="A grid of who-can-do-what is Table and Checkbox composed, not a component of its own — the only thing worth naming here is the validation state: an invalid cell gets a danger-toned ring on the Checkbox itself plus one error line under the matrix, not a per-cell message that would repeat six times for one mistake."
        >
          <TableScroll className="rounded-none border-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Permission</TableHead>
                  <TableHead className="text-center">Director</TableHead>
                  <TableHead className="text-center">Finance</TableHead>
                  <TableHead className="text-center">Procurement</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>View purchase orders</TableCell>
                  <TableCell className="text-center">
                    <Checkbox defaultChecked aria-label="Director — View purchase orders" />
                  </TableCell>
                  <TableCell className="text-center">
                    <Checkbox defaultChecked aria-label="Finance — View purchase orders" />
                  </TableCell>
                  <TableCell className="text-center">
                    <Checkbox disabled defaultChecked aria-label="Procurement — View purchase orders" />
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Approve purchase orders</TableCell>
                  <TableCell className="text-center">
                    <Checkbox defaultChecked aria-label="Director — Approve purchase orders" />
                  </TableCell>
                  <TableCell className="text-center">
                    <Checkbox aria-label="Finance — Approve purchase orders" />
                  </TableCell>
                  <TableCell className="text-center">
                    <Checkbox defaultChecked aria-label="Procurement — Approve purchase orders" />
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    Manage supplier data
                    <p className="mt-0.5 text-caption text-danger">Select at least one role.</p>
                  </TableCell>
                  <TableCell className="text-center">
                    <Checkbox aria-label="Director — Manage supplier data" />
                  </TableCell>
                  <TableCell className="text-center">
                    <Checkbox
                      aria-invalid
                      className="border-danger"
                      aria-label="Finance — Manage supplier data"
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    <Checkbox defaultChecked aria-label="Procurement — Manage supplier data" />
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableScroll>
        </Specimen>
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
            <Alert
              variant="warning"
              icon={<Warning size={18} weight="fill" aria-hidden="true" />}
              title="Structural materials at 91% while work is 73%"
              messages={[
                'Structural materials cost has reached 91% of budget, while physical progress is 73%. Review usage, delivery schedule, and remaining quantities to avoid cost overrun.',
              ]}
              action={
                <Button variant="outline" size="sm">
                  Investigate
                </Button>
              }
            />
          </div>
          <p className="mt-4 text-caption leading-5 text-muted-foreground">
            <code className="font-mono text-caption">messages</code> takes an array because the
            API returns <code className="font-mono text-caption">error.message</code> as an
            array for 400 validation failures — one entry per failed constraint. Concatenating
            them produces one unreadable line.{' '}
            <code className="font-mono text-caption">icon</code> and{' '}
            <code className="font-mono text-caption">action</code> are both optional — most
            alerts need neither; reach for them for a standalone attention card like the one
            above, not for a routine form or toast error.
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

        <Specimen
          label="Skeleton — shaped like what it replaces"
          token="<SkeletonTable> · <SkeletonForm> · <SkeletonRecord>"
          note="A single grey rectangle tells the reader only that something is happening. A header row over four body rows tells them a table is coming and roughly how big — which costs one component and removes the layout shift when data lands. Rows read h-row, so a compact user's skeleton is compact and the page does not jump by 8px per row."
        >
          <div className="flex flex-col gap-6">
            <div>
              <p className="mb-3 text-micro font-semibold uppercase text-muted-foreground">
                SkeletonTable · 5 columns
              </p>
              <SkeletonTable columns={5} rows={4} label="Loading bills" />
            </div>
            <div>
              <p className="mb-3 text-micro font-semibold uppercase text-muted-foreground">
                SkeletonForm · 4 fields
              </p>
              <SkeletonForm fields={4} label="Loading form" />
            </div>
            <div>
              <p className="mb-3 text-micro font-semibold uppercase text-muted-foreground">
                SkeletonRecord — header, tiles, body and rail
              </p>
              <SkeletonRecord label="Loading record" />
            </div>
          </div>
        </Specimen>

        <Rule>
          Placeholders are <code className="font-mono text-caption">aria-hidden</code> and the
          set is wrapped in one <code className="font-mono text-caption">role=&quot;status&quot;</code>{' '}
          region carrying <code className="font-mono text-caption">aria-busy</code>. Without
          that, a screen reader reads &ldquo;blank blank blank blank&rdquo; down a skeleton
          table. The loading state is announced once, by the region that owns it.
        </Rule>

        <Pending>
          Retiring the <strong className="font-semibold">50 hand-rolled{' '}
          <code className="font-mono text-caption">animate-pulse</code> blocks</strong> onto these
          three is Phase 3 work, done per module as each screen is refitted — a sweep of all
          fifty at once would collide with everything else in flight.
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

        <Specimen label="Progress and Meter" token="<Progress value max tone> · <Meter value max>">
          <div className="flex flex-col gap-6">
            <div className="max-w-sm space-y-3">
              <div className="flex items-center justify-between text-body-sm">
                <span className="text-muted-foreground">Budget exposure</span>
                <span className="font-semibold text-foreground">84.8%</span>
              </div>
              <Progress value={84.8} tone="warning" label="Budget exposure" />
              <Progress value={48} tone="default" size="sm" label="Actual to date" />
            </div>
            <div className="flex flex-wrap items-center gap-8">
              <Meter value={68} tone="default" />
              <Meter value={92} tone="danger" size={72} strokeWidth={6} />
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
        <Specimen label="Dialog and DropdownMenu" token="<Dialog> · <DropdownMenu>">
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

        <Specimen label="Sheet" token="<Sheet> · <SheetContent side>">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline">Open requisition PR-2026-0148</Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>PR-2026-0148</SheetTitle>
                <SheetDescription>Submitted 22 Sep 2026 by Ahmed Ali.</SheetDescription>
              </SheetHeader>
              <SheetBody>
                <p className="text-body-sm text-muted-foreground">
                  Concrete, rebar and formwork materials for foundation works — Block A.
                </p>
              </SheetBody>
              <SheetFooter>
                <SheetClose asChild>
                  <Button>View approval</Button>
                </SheetClose>
                <SheetClose asChild>
                  <Button variant="outline">Edit</Button>
                </SheetClose>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </Specimen>

        <Rule>
          Reach for <code className="font-mono text-caption">Dialog</code> first —{' '}
          <code className="font-mono text-caption">Sheet</code> is for a screen genuinely built
          as list-on-one-side, detail-on-the-other, not a default replacement for a confirmation
          or a create form. See the component&rsquo;s own doc comment for why (
          <code className="font-mono text-caption">boq-item-drawer.tsx</code>&rsquo;s history).
        </Rule>

        <Specimen label="Tooltip" token="<Tooltip> · <TooltipTrigger> · <TooltipContent>">
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge tone="info" dot>
                Committed
              </Badge>
            </TooltipTrigger>
            <TooltipContent>Ordered but not yet received or billed.</TooltipContent>
          </Tooltip>
        </Specimen>

        <Rule>
          Not for a truncated cell&rsquo;s full text — a native{' '}
          <code className="font-mono text-caption">title=</code> on the truncated span already
          works for that. Reach for <code className="font-mono text-caption">Tooltip</code> only
          where the hint explains something a label cannot say in its own space.
        </Rule>
      </Section>
    </>
  );
}
