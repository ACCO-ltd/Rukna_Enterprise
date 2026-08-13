'use client';

import { useState } from 'react';
import {
  ApprovalChain,
  ApprovalNotConfigured,
  ApprovalTimeline,
  Badge,
  Button,
  DecisionPanel,
  DefinitionList,
  DefinitionRow,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  OverflowGlyph,
  RecordHeader,
  RecordLayout,
  RecordPanel,
  RowActions,
  SavedViews,
  StatTile,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  useToast,
  useWizard,
  WizardRail,
  WizardStepPanel,
  WizardSuccess,
  WizardSummaryRow,
  type ApprovalStep,
  type WizardStep,
} from '@erp/ui';

import { StatusBadge } from '@/components/status-badge';

import { Pending, Rule, Section, Specimen } from './gallery-chrome';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CHAIN: ApprovalStep[] = [
  { id: 'raised', title: 'Raised', actor: 'Fadumo Ali · Site engineer', at: '09 Aug · 09:30', state: 'approved' },
  { id: 'pm', title: 'Project manager', actor: 'Ahmed Shirie', at: '09 Aug · 14:05', state: 'approved' },
  { id: 'fm', title: 'Finance manager', actor: 'Liibaan Johnson', state: 'current', isYou: true },
  {
    id: 'fd',
    title: 'Finance director',
    state: 'upcoming',
    condition: 'Required above 5 000 000 SOS',
  },
];

const CHAIN_RETURNED: ApprovalStep[] = [
  { id: 'raised', title: 'Raised', actor: 'Fadumo Ali', at: '09 Aug · 09:30', state: 'approved' },
  {
    id: 'pm',
    title: 'Project manager',
    actor: 'Ahmed Shirie',
    at: '09 Aug · 14:05',
    state: 'returned',
    comment: 'Rate for item 2.3 is above the BOQ rate. Re-measure or raise a variation first.',
  },
  { id: 'fm', title: 'Finance manager', state: 'upcoming' },
  { id: 'fd', title: 'Finance director', state: 'skipped', condition: 'Not required below 5 000 000 SOS' },
];

const VIEWS = [
  { id: 'match', label: 'Awaiting match', count: 7 },
  { id: 'post', label: 'Ready to post', count: 3 },
  { id: 'posted', label: 'Posted', count: 128 },
  { id: 'all', label: 'All bills', count: 141 },
] as const;

const BILLS = [
  { ref: 'BILL-2026-0311', po: 'PO-2026-00418 R2', supplier: 'Horyaal Building Materials', status: 'APPROVED', amount: '486 200.00', balance: '486 200.00', action: 'Review match' },
  { ref: 'BILL-2026-0310', po: 'Non-PO', supplier: 'Berbera Freight & Logistics', status: 'PAID', amount: '62 400.00', balance: '0.00', action: 'View journal' },
  { ref: 'BILL-2026-0309', po: 'PO-2026-00402 R1', supplier: 'Sheikh Steel Trading', status: 'PARTIALLY_PAID', amount: '1 204 750.00', balance: '300 000.00', action: 'Pay' },
  { ref: 'BILL-2026-0308', po: 'Non-PO', supplier: 'Hargeisa Plant Hire', status: 'DRAFT', amount: '318 000.00', balance: '318 000.00', action: 'Submit' },
];

// ─── Section ──────────────────────────────────────────────────────────────────

export function RecordsSection() {
  return (
    <>
      <StatTilesSpecimen />
      <RecordLayoutSpecimen />
      <ApprovalSpecimen />
      <ListSpecimen />
      <WizardSpecimen />
    </>
  );
}

// ─── Stat tiles ───────────────────────────────────────────────────────────────

function StatTilesSpecimen() {
  return (
    <Section
      id="tiles"
      title="Stat tiles"
      intro="A number with nothing to compare it to is trivia. Every tile carries a unit, a direction and the comparison it is measured against — and where the platform cannot trust the figure, it says so instead of showing it confidently."
    >
      <Specimen label="StatTile" token="<StatTile>">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Certified to date"
            value="4.86"
            unit="M SOS"
            delta={{ value: '12.4%', direction: 'up', context: 'vs. Jul 2026' }}
          />
          <StatTile
            label="Outstanding"
            value="1.21"
            unit="M SOS"
            delta={{ value: '3.1%', direction: 'down', isGood: true, context: '3 invoices overdue' }}
          />
          <StatTile
            label="Committed"
            value="2.94"
            unit="M SOS"
            note={<Badge tone="warning">Accuracy note</Badge>}
          />
          <StatTile
            label="Retention held"
            value="243"
            unit="K SOS"
            trend={[180, 191, 188, 205, 209, 228, 243]}
            delta={{ value: '6.6%', direction: 'up', context: 'across 7 periods' }}
          />
        </div>
      </Specimen>

      <Rule>
        Colour follows meaning, not direction. &ldquo;Outstanding down 3.1%&rdquo; is good news
        pointing down, so it passes <code className="font-mono text-caption">isGood</code> — the
        arrow still points down and the tone is still green. Defaulting to &ldquo;up is
        good&rdquo; is right often enough to be useful and wrong often enough that it has to be
        overridable.
      </Rule>

      <Specimen
        label="An unavailable figure"
        token="value={null}"
        note="This is the fix for the two tiles on the live project page reading 'IPC aggregation endpoint pending'. A blank must not look like a zero — a zero is a fact, a blank is an absence — and the reason must be in the reader's terms, not the implementation's."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatTile label="Certified revenue" value={null} unavailableReason="Not yet available for this project" />
          <StatTile label="Received" value={null} unavailableReason="No receipts recorded" />
          <StatTile label="Cost variance" value="0.00" unit="SOS" delta={{ value: '0.0%', direction: 'flat', context: 'no movement this period' }} />
        </div>
      </Specimen>
    </Section>
  );
}

// ─── Record layout ────────────────────────────────────────────────────────────

function RecordLayoutSpecimen() {
  return (
    <Section
      id="record"
      title="Record layout"
      intro="One convention for every detail page. It is the cheapest change with the largest effect on 'feels enterprise', because it is what makes a record legible without scrolling back."
    >
      <Specimen label="RecordLayout — supplier bill" token="<RecordLayout>" bare>
        <div className="p-5">
          <RecordLayout
            header={
              <RecordHeader
                breadcrumb={
                  <span className="text-caption text-muted-foreground">Supplier bills</span>
                }
                identifier="BILL-2026-0311"
                title="Horyaal Building Materials"
                subtitle="Against PO-2026-00418 R2 · Hargeisa Ring Road, Pkg 2"
                status={<StatusBadge status="APPROVED" />}
                figure={{ label: 'Amount due', value: '486 200.00' }}
                actions={
                  <>
                    <Button>Review match</Button>
                    <Button variant="outline">Post</Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label="More actions">
                          <OverflowGlyph />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem>Download PDF</DropdownMenuItem>
                        <DropdownMenuItem>Duplicate</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem>Reverse posting</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                }
              />
            }
            banner={<RecordPanel padded={false}><div className="p-4"><ApprovalChain steps={CHAIN} label="Approval chain" awaitingYouSlot={<Badge tone="info">Awaiting you</Badge>} /></div></RecordPanel>}
            rail={
              <>
                <RecordPanel title="Summary">
                  <DefinitionList>
                    <DefinitionRow label="Supplier">Horyaal Building Materials</DefinitionRow>
                    <DefinitionRow label="Bill date">12 Aug 2026</DefinitionRow>
                    <DefinitionRow label="Due">11 Sep 2026 · Net 30</DefinitionRow>
                    <DefinitionRow label="Gross" numeric>486 200.00</DefinitionRow>
                    <DefinitionRow label="Paid" numeric>0.00</DefinitionRow>
                    <DefinitionRow label="Balance" numeric tone="warning">486 200.00</DefinitionRow>
                    <DefinitionRow label="Journal" emptyText="Not posted">{null}</DefinitionRow>
                  </DefinitionList>
                </RecordPanel>

                <RecordPanel title="History">
                  <ApprovalTimeline steps={CHAIN} label="Approval history" upcomingLabel="Not yet reached" />
                </RecordPanel>

                <RecordPanel title="Attachments" action={<Badge tone="neutral">2</Badge>}>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono text-micro text-muted-foreground">PDF</span>
                      <span className="text-body-sm text-foreground">Horyaal_invoice_Aug26.pdf</span>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono text-micro text-muted-foreground">XLSX</span>
                      <span className="text-body-sm text-foreground">Delivery_notes.xlsx</span>
                    </div>
                  </div>
                </RecordPanel>
              </>
            }
          >
            <RecordPanel title="Lines" padded={false}>
              <TableScroll className="rounded-none border-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead numeric>Qty</TableHead>
                      <TableHead numeric>Rate</TableHead>
                      <TableHead numeric>Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell>Ready-mix concrete C30</TableCell>
                      <TableCell numeric>1 240.500</TableCell>
                      <TableCell numeric>185.00</TableCell>
                      <TableCell numeric>229 492.50</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Reinforcement bar 16mm</TableCell>
                      <TableCell numeric>82.000</TableCell>
                      <TableCell numeric>3 132.00</TableCell>
                      <TableCell numeric>256 707.50</TableCell>
                    </TableRow>
                    <TableRow className="bg-surface-subtle">
                      <TableCell className="font-semibold">Total</TableCell>
                      <TableCell numeric />
                      <TableCell numeric />
                      <TableCell numeric className="font-semibold">486 200.00</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </TableScroll>
            </RecordPanel>
          </RecordLayout>
        </div>
      </Specimen>

      <Rule>
        Totals sit at the foot of the table they total, not in a separate card. A missing value
        says it is missing — the Journal row reads &ldquo;Not posted&rdquo;, because an empty
        cell leaves the reader unable to tell &ldquo;not set&rdquo; from &ldquo;still
        loading&rdquo;. Below <code className="font-mono text-caption">lg</code> the rail moves
        under the body in source order, which is why summary must come first in it.
      </Rule>
    </Section>
  );
}

// ─── Approval ─────────────────────────────────────────────────────────────────

function ApprovalSpecimen() {
  const { toast } = useToast();

  return (
    <Section
      id="approval"
      title="Approval"
      intro="The platform's whole backend proposition is a governed approval chain with delegation-of-authority thresholds. Material requests, purchase orders, bills, payments, journals, certificates, contracts and variations all route for approval — and to the person approving them it is the same mechanism, so it should look like one."
    >
      <Specimen label="Chain — in progress, awaiting you" token="<ApprovalChain>">
        <ApprovalChain steps={CHAIN} label="Approval chain" awaitingYouSlot={<Badge tone="info">Awaiting you</Badge>} />
      </Specimen>

      <Specimen
        label="Chain — returned, with a step no longer required"
        token="state: returned · skipped"
        note="The returned step is amber and reversed, not red: the document is alive and someone has to act, which is a different fact from rejected. The final step is struck through as skipped, with the threshold that excused it."
      >
        <ApprovalChain steps={CHAIN_RETURNED} label="Approval chain, returned" />
      </Specimen>

      <Specimen label="Decision panel" token="<DecisionPanel>">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <RecordPanel title="Your decision" action={<Badge tone="warning">Step 3 of 4</Badge>}>
            <DecisionPanel
              labels={{
                commentLabel: 'Comment',
                commentNote: 'required to return or reject',
                commentPlaceholder: 'Add context for the next approver…',
                approve: 'Approve',
                return: 'Return for changes',
                reject: 'Reject',
                commentRequired: 'Say what needs to change — the person receiving this cannot act on a bare rejection.',
              }}
              onDecide={(decision, comment) =>
                toast({
                  tone: decision === 'reject' ? 'error' : decision === 'return' ? 'warning' : 'success',
                  title:
                    decision === 'approve'
                      ? 'Purchase order approved'
                      : decision === 'return'
                        ? 'Returned to the project manager'
                        : 'Purchase order rejected',
                  description: comment || undefined,
                })
              }
            >
              <DefinitionList>
                <DefinitionRow label="Supplier">Horyaal Building Materials</DefinitionRow>
                <DefinitionRow label="Order value" numeric>4 862 000.00 SOS</DefinitionRow>
                <DefinitionRow label="Committed against">Hargeisa Ring Road · Pkg 2</DefinitionRow>
                <DefinitionRow label="Uncommitted budget" numeric tone="warning">1 118 400.00 SOS</DefinitionRow>
              </DefinitionList>
            </DecisionPanel>
          </RecordPanel>

          <RecordPanel title="History">
            <ApprovalTimeline steps={CHAIN_RETURNED} label="Approval history" upcomingLabel="Not yet reached" />
          </RecordPanel>
        </div>
      </Specimen>

      <Rule>
        Try Return or Reject with the comment empty. Approving needs no explanation — the
        decision is the record — but returning or rejecting always does, because the person on
        the other end has to know what to change. Enforced in the component rather than left to
        each caller, since it is the same rule for every document type.
      </Rule>

      <Specimen
        label="No workflow configured"
        token="<ApprovalNotConfigured> — the 422"
        note="The API returns 422 when a document needs an approval workflow nobody has configured. That is not a failure of the user's action, so it must not surface as a toast that disappears — it is a statement about this document, rendered where the chain would have been. And because the reader cannot fix it, it says who can."
      >
        <ApprovalNotConfigured
          title="No approval workflow is configured for purchase orders"
          description="This order cannot be submitted until an administrator defines an approval chain for purchase orders above 1 000 000 SOS. Contact your system administrator."
        />
      </Specimen>
    </Section>
  );
}

// ─── List ─────────────────────────────────────────────────────────────────────

function ListSpecimen() {
  const [view, setView] = useState<string>('match');

  return (
    <Section
      id="views"
      title="Saved views and row actions"
      intro="A supplier bills screen is not one list, it is four questions. The count on the tab is the point: 'Awaiting match 7' is a to-do list, 'Awaiting match' is a menu item."
    >
      <Specimen label="SavedViews + RowActions" token="<SavedViews> · <RowActions>" bare>
        <div className="bg-surface">
          <SavedViews views={VIEWS} activeId={view} onSelect={setView} label="Bill views" controls="ds-bills" />
          <TableScroll className="rounded-none border-0 border-t">
            <Table id="ds-bills">
              <TableHeader>
                <TableRow>
                  <TableHead>Bill</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead numeric>Amount</TableHead>
                  <TableHead numeric>Balance</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {BILLS.map((bill) => (
                  <TableRow key={bill.ref}>
                    <TableCell>
                      <span className="block font-mono text-caption text-foreground">{bill.ref}</span>
                      <span className="block font-mono text-micro tracking-normal text-muted-foreground">{bill.po}</span>
                    </TableCell>
                    <TableCell>{bill.supplier}</TableCell>
                    <TableCell><StatusBadge status={bill.status} /></TableCell>
                    <TableCell numeric>{bill.amount}</TableCell>
                    <TableCell numeric>{bill.balance}</TableCell>
                    <TableCell>
                      <RowActions
                        overflow={
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" aria-label={`More actions for ${bill.ref}`}>
                                <OverflowGlyph />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                              <DropdownMenuItem>Open</DropdownMenuItem>
                              <DropdownMenuItem>Download PDF</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem>Delete draft</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        }
                      >
                        <Button variant="outline" size="sm">{bill.action}</Button>
                      </RowActions>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableScroll>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
            <p className="text-body-sm text-muted-foreground">
              4 of 7 bills ·{' '}
              <b className="font-semibold tabular-nums text-foreground">2 071 350.00 SOS</b> outstanding
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled>Previous</Button>
              <Button variant="outline" size="sm">Next</Button>
            </div>
          </div>
        </div>
      </Specimen>

      <Rule>
        The primary row action is per-row, not per-column: a draft bill offers Submit, a matched
        one offers Pay, a posted one offers View journal. That is a property of the record&rsquo;s
        state, and passing it per row is what keeps the column honest. One visible action plus an
        overflow — four buttons per row is a toolbar repeated down the page, and at 375px it
        decides the table&rsquo;s width.
      </Rule>

      <Rule>
        The footer totals the money in view. A financial list that does not add up its own column
        pushes the reader into a spreadsheet to answer the question the list exists to answer —
        and the total is computed from the rows actually on screen after search, sort and paging,
        so it always matches what is visible.
      </Rule>

      <Pending>
        <code className="font-mono text-caption">PlatformDataGrid</code> now accepts{' '}
        <code className="font-mono text-caption">savedViews</code> and{' '}
        <code className="font-mono text-caption">footerSummary</code>, and its{' '}
        <code className="font-mono text-caption">rowActions</code> prop already existed and was
        used by nothing. Adopting all three per module is Phase 3.
      </Pending>
    </Section>
  );
}

// ─── Wizard ───────────────────────────────────────────────────────────────────

type StepId = 'application' | 'quantities' | 'deductions' | 'review';

function WizardSpecimen() {
  const [quantities, setQuantities] = useState('1240.500');
  const [done, setDone] = useState(false);

  const steps: WizardStep<StepId>[] = [
    {
      id: 'application',
      label: 'Application',
      summary: () => 'IPA-2026-0117 · Submitted 9 Aug 2026',
      render: () => (
        <DefinitionList>
          <DefinitionRow label="Application">IPA-2026-0117</DefinitionRow>
          <DefinitionRow label="Submitted">09 Aug 2026</DefinitionRow>
          <DefinitionRow label="Claimed" numeric>486 200.00 SOS</DefinitionRow>
        </DefinitionList>
      ),
    },
    {
      id: 'quantities',
      label: 'Quantities',
      // The gate. Returning false keeps the user here; the caller owns the field error.
      validate: () => Number(quantities) > 0,
      summary: () => `18 lines certified · gross ${quantities} SOS`,
      render: () => (
        <div className="max-w-sm">
          <label htmlFor="ds-wz-qty" className="block text-caption font-semibold text-foreground">
            Certified quantity
          </label>
          <input
            id="ds-wz-qty"
            value={quantities}
            onChange={(e) => setQuantities(e.target.value)}
            className="mt-1.5 flex h-control w-full rounded-control border border-border-strong bg-surface px-3.5 text-sm tabular-nums text-foreground shadow-e1 focus:border-brand-primary focus:outline-none focus:shadow-ring"
          />
          <p className="mt-1.5 text-caption text-muted-foreground">
            Set this to 0 and press Continue — the gate refuses and the step does not advance.
          </p>
        </div>
      ),
    },
    {
      id: 'deductions',
      label: 'Deductions',
      summary: () => 'Retention 24 310.00 · Advance recovery 48 620.00',
      render: () => (
        <DefinitionList>
          <DefinitionRow label="Retention" numeric>24 310.00 SOS · 5%</DefinitionRow>
          <DefinitionRow label="Advance recovery" numeric>48 620.00 SOS · 10%</DefinitionRow>
          <DefinitionRow label="Further deductions" emptyText="None added">{null}</DefinitionRow>
        </DefinitionList>
      ),
    },
    {
      id: 'review',
      label: 'Review & issue',
      render: () => (
        <DefinitionList>
          <DefinitionRow label="Gross certified" numeric>486 200.00 SOS</DefinitionRow>
          <DefinitionRow label="Total deductions" numeric>72 930.00 SOS</DefinitionRow>
          <DefinitionRow label="Net certified" numeric tone="success">413 270.00 SOS</DefinitionRow>
        </DefinitionList>
      ),
    },
  ];

  const wizard = useWizard<StepId>(steps, { onComplete: () => setDone(true) });
  const step = steps[wizard.currentIndex];

  if (done) {
    return (
      <Section id="wizard" title="Guided flows" intro="The terminal screen. A flow that ends by silently landing somewhere else leaves the user unsure whether it worked.">
        <Specimen label="WizardSuccess" token="<WizardSuccess>">
          <WizardSuccess
            title="Certificate issued"
            reference="IPC-2026-0042"
            description="Net certified 413 270.00 SOS. The application is now certified and the client invoice can be generated."
            actions={
              <>
                <Button>View certificate</Button>
                <Button variant="outline" onClick={() => setDone(false)}>Run the flow again</Button>
              </>
            }
          />
        </Specimen>
      </Section>
    );
  }

  return (
    <Section
      id="wizard"
      title="Guided flows"
      intro="Three flows in this product are already stepped and each built its own step state, its own gate, its own idea of what 'back' means. This is the shell they should share. It is live — walk it."
    >
      <Specimen label="Wizard" token="useWizard() · <WizardRail> · <WizardSummaryRow>">
        <WizardRail steps={steps} wizard={wizard} label="Progress" onNavigate={wizard.goTo} />

        <div className="mt-6 flex flex-col gap-2">
          {/* Completed steps stay on screen, collapsed to what they captured. */}
          {steps.slice(0, wizard.currentIndex).map((s) =>
            wizard.statusOf(s.id) === 'complete' && s.summary ? (
              <WizardSummaryRow
                key={s.id}
                label={s.label}
                value={s.summary()}
                changeLabel="Change"
                onChange={() => wizard.goTo(s.id)}
              />
            ) : null,
          )}

          {step ? (
            <WizardStepPanel
              className="mt-2"
              stepLabel={`Step ${wizard.currentIndex + 1} of ${steps.length}`}
              title={step.label}
              description={
                step.id === 'deductions'
                  ? 'Retention and advance recovery are calculated from the contract and cannot be edited here.'
                  : undefined
              }
              footer={
                <>
                  <span className="flex-1" />
                  {!wizard.isFirst ? (
                    <Button variant="ghost" onClick={wizard.back}>Back</Button>
                  ) : null}
                  <Button onClick={() => void wizard.next()} disabled={wizard.validating}>
                    {wizard.isLast ? 'Issue certificate' : 'Continue'}
                  </Button>
                </>
              }
            >
              {step.render()}
            </WizardStepPanel>
          ) : null}
        </div>
      </Specimen>

      <Rule>
        What makes a long flow feel effortless is not the row of dots — it is that a completed
        step collapses into a labelled row carrying the values it captured and <em>stays on
        screen</em>. Press Change on one: it returns to exactly that step without unwinding the
        rest. Forward jumps on the rail are refused, because reaching step 4 without passing
        step 2&rsquo;s gate is what the gate exists to prevent.
      </Rule>

      <Pending>
        The shell deliberately owns no data and persists nothing.{' '}
        <code className="font-mono text-caption">apps/web/CLAUDE.md</code> forbids caching
        sensitive financial data in <code className="font-mono text-caption">localStorage</code>{' '}
        or <code className="font-mono text-caption">sessionStorage</code>, and{' '}
        <code className="font-mono text-caption">ipc/wizard/draft.ts</code> persists certified
        quantities and deductions to <code className="font-mono text-caption">sessionStorage</code>{' '}
        today. A shell offering draft persistence would make that the default for every future
        flow. Refitting the three existing wizards — and deciding what to do about that draft —
        is Phase 3.
      </Pending>
    </Section>
  );
}
