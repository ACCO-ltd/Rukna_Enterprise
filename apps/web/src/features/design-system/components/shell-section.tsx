'use client';

import { useMemo, useState } from 'react';
import {
  ActivityTimeline,
  ApprovalTimeline,
  Button,
  DocumentActionBar,
  DocumentTabs,
  SummaryRail,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  TotalsBlock,
  DocumentIdentity,
  type FilterValues,
  LifecycleStepper,
  type ListFilterField,
  MoneyDisplay,
  Notice,
  StatusPill,
  StatusText,
} from '@erp/ui';
import { ArrowLeft, Plus } from 'lucide-react';

import { ModuleHeader } from '@/components/layout/module-chrome';
import type { ModuleTab } from '@/components/layout/module-nav';
import { ModuleTabs } from '@/components/layout/module-tabs';
import { PlatformDataGrid, type GridColumn } from '@/components/platform-data-grid';
import { statusLabel, statusTone } from '@/lib/status-registry';

import { Section, Specimen } from './gallery-chrome';

// ─── Sample data — ACCO, never lorem ipsum ────────────────────────────────────

const ACCOUNTING_TABS: ModuleTab[] = [
  {
    kind: 'menu',
    key: 'receivables',
    labelKey: 'group.receivables',
    active: false,
    items: [
      { href: '/finance/accounting/invoices', labelKey: 'clientInvoices', active: false },
      { href: '/receipts', labelKey: 'receipts', active: false },
    ],
  },
  {
    kind: 'menu',
    key: 'payables',
    labelKey: 'group.payables',
    active: true,
    items: [
      { href: '/finance/accounting/bills', labelKey: 'supplierBills', active: true },
      { href: '/finance/accounting/payments', labelKey: 'supplierPayments', active: false },
    ],
  },
  {
    kind: 'menu',
    key: 'ledger',
    labelKey: 'group.ledger',
    active: false,
    items: [
      { href: '/finance/accounting/journals', labelKey: 'journals', active: false },
      { href: '/finance/accounting/ledger', labelKey: 'accountLedger', active: false },
    ],
  },
  {
    kind: 'menu',
    key: 'reports',
    labelKey: 'group.reports',
    active: false,
    items: [{ href: '/finance/accounting/trial-balance', labelKey: 'trialBalance', active: false }],
  },
  {
    kind: 'menu',
    key: 'acctSetup',
    labelKey: 'group.acctSetup',
    active: false,
    items: [{ href: '/finance/accounting/periods', labelKey: 'fiscalPeriods', active: false }],
  },
];

interface SampleBill {
  id: string;
  number: string;
  ref: string;
  supplier: string;
  due: string;
  amount: string;
  doc: string;
  posting: string;
  match: string | null;
}

const BILLS: SampleBill[] = [
  { id: '42', number: 'BILL-2026-0042', ref: 'BCC/INV/5531', supplier: 'Berbera Cement Co.', due: '14 Oct 2026', amount: '5660.00', doc: 'APPROVED', posting: 'NOT_POSTED', match: 'EXCEPTION' },
  { id: '41', number: 'BILL-2026-0041', ref: 'MST-2291', supplier: 'Mogadishu Steel Traders', due: '11 Oct 2026', amount: '18420.00', doc: 'APPROVED', posting: 'POSTED', match: 'MATCHED' },
  { id: '40', number: 'BILL-2026-0040', ref: 'HL-0877', supplier: 'Hormuud Logistics', due: '09 Oct 2026', amount: '1150.00', doc: 'SUBMITTED', posting: 'NOT_POSTED', match: null },
  { id: '37', number: 'BILL-2026-0037', ref: 'HL-0851', supplier: 'Hormuud Logistics', due: '20 Sep 2026', amount: '960.00', doc: 'APPROVED', posting: 'REVERSED', match: null },
  { id: '35', number: 'BILL-2026-0035', ref: 'MST-2231', supplier: 'Mogadishu Steel Traders', due: '07 Sep 2026', amount: '4140.00', doc: 'REJECTED', posting: 'NOT_POSTED', match: 'DISPUTED' },
];

const FILTERS: ListFilterField[] = [
  {
    key: 'doc',
    type: 'select',
    label: 'Approval status',
    options: ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'].map((s) => ({ value: s, label: statusLabel(s) })),
  },
  {
    key: 'posting',
    type: 'select',
    label: 'Posting',
    options: ['NOT_POSTED', 'POSTED', 'REVERSED'].map((s) => ({ value: s, label: statusLabel(s, 'posting') })),
  },
];

const STAGES = [
  { key: 'DRAFT', label: 'Draft' },
  { key: 'SUBMITTED', label: 'Submitted' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'POSTED', label: 'Posted' },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function ShellSection() {
  const [filters, setFilters] = useState<FilterValues>({ doc: 'APPROVED' });
  const [moneyBlind, setMoneyBlind] = useState(false);

  const rows = useMemo(
    () =>
      BILLS.filter(
        (b) => (!filters.doc || b.doc === filters.doc) && (!filters.posting || b.posting === filters.posting),
      ),
    [filters],
  );

  const columns: GridColumn<SampleBill>[] = [
    {
      key: 'number',
      header: 'Bill',
      sticky: true,
      sortable: true,
      card: 'title',
      plainValue: (b) => b.number,
      render: (b) => (
        <span className="block">
          <span className="block font-semibold text-brand-primary">{b.number}</span>
          <span className="block text-caption text-muted-foreground">Supplier ref {b.ref}</span>
        </span>
      ),
    },
    { key: 'supplier', header: 'Supplier', sortable: true, card: 'subtitle', plainValue: (b) => b.supplier, render: (b) => <span className="font-medium">{b.supplier}</span> },
    { key: 'due', header: 'Due date', card: 'meta', render: (b) => b.due },
    {
      key: 'amount',
      header: 'Amount',
      numeric: true,
      sortable: true,
      card: 'amount',
      redacted: moneyBlind,
      plainValue: (b) => Number(b.amount),
      render: (b) => <MoneyDisplay value={b.amount} />,
    },
    {
      key: 'status',
      header: 'Status',
      card: 'status',
      render: (b) => (
        <span className="flex flex-col items-start gap-1">
          <StatusPill tone={statusTone(b.doc, 'supplierBill')}>{statusLabel(b.doc)}</StatusPill>
          <StatusText tone={statusTone(b.posting, 'posting')}>{statusLabel(b.posting, 'posting')}</StatusText>
        </span>
      ),
    },
    {
      key: 'match',
      header: 'PO match',
      card: 'status',
      render: (b) =>
        b.match ? (
          <StatusText tone={statusTone(b.match, 'billMatch')}>{statusLabel(b.match, 'billMatch')}</StatusText>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <>
      {/* ── Module shell ────────────────────────────────────────────────── */}
      <Section
        id="module"
        title="Module shell"
        intro="The sidebar lists modules only. A module's pages live in its tab bar under the module header — one navigation system per page (ADR-035). Resize the window: trailing tabs collapse into More, and below 560px the bar becomes one section picker."
      >
        <Specimen label="ModuleHeader + ModuleTabs" token="<ModuleChrome> · resolveModule · moduleTabs" bare>
          <div className="p-4">
            <ModuleHeader
              title="Accounting"
              crumbs={[{ label: 'Payables' }, { label: 'Supplier bills', href: '#module' }, { label: 'BILL-2026-0042' }]}
              description="Receivables, payables and the general ledger for ACCO Ltd. All amounts in USD."
            >
              <ModuleTabs tabs={ACCOUNTING_TABS} navLabel="Accounting sections" />
            </ModuleHeader>
          </div>
        </Specimen>
      </Section>

      {/* ── List page ───────────────────────────────────────────────────── */}
      <Section
        id="list"
        title="List page"
        intro="Toolbar (scoped search, Filter, one primary create) → applied filters as chips → navy-header grid. The document number is the row's one link. Below 640px each row becomes a card built from the columns' card roles."
      >
        <Specimen
          label="PlatformDataGrid — supplier bills"
          token="<PlatformDataGrid filters card redacted>"
          note="Toggle the viewer to see a money-blind role: the amount column renders hidden and is no longer sortable."
          bare
        >
          <div className="space-y-3 p-4">
            <div className="flex gap-2">
              <Button variant={moneyBlind ? 'outline' : 'default'} size="sm" onClick={() => setMoneyBlind(false)}>
                Finance Manager
              </Button>
              <Button variant={moneyBlind ? 'default' : 'outline'} size="sm" onClick={() => setMoneyBlind(true)}>
                Project Manager
              </Button>
            </div>
            <PlatformDataGrid
              columns={columns}
              data={rows}
              rowKey={(b) => b.id}
              label="Supplier bills"
              rowHref={() => '#list'}
              filters={FILTERS}
              filterValues={filters}
              onFilterValuesChange={setFilters}
              searchPlaceholder="Search bills, suppliers, references"
              pagination={{ defaultPageSize: 10 }}
              toolbarActions={
                <Button className="gap-1.5">
                  <Plus size={16} aria-hidden="true" />
                  New PO bill
                </Button>
              }
            />
          </div>
        </Specimen>
      </Section>

      {/* ── Document ────────────────────────────────────────────────────── */}
      <Section
        id="document"
        title="Document"
        intro="Sticky action bar (back, the one primary command for this state, secondaries in a kebab, read-only lifecycle) → identity with labelled axes → at most one notice. Unavailable commands are not rendered; a blocked one is explained in words."
      >
        <Specimen label="Supplier bill · Draft" token="<DocumentActionBar> · <LifecycleStepper>">
          <DocumentActionBar
            className="static"
            back={<Button variant="ghost" className="gap-1.5 px-2"><ArrowLeft size={16} aria-hidden="true" />Supplier bills</Button>}
            primary={<Button>Submit for approval</Button>}
            lifecycle={<LifecycleStepper steps={STAGES} current="DRAFT" />}
          />
        </Specimen>
        <Specimen label="Supplier bill · Approved, posting blocked — no primary; the notice explains">
          <DocumentActionBar
            className="static"
            back={<Button variant="ghost" className="gap-1.5 px-2"><ArrowLeft size={16} aria-hidden="true" />Supplier bills</Button>}
            lifecycle={<LifecycleStepper steps={STAGES} current="APPROVED" />}
          />
          <DocumentIdentity
            eyebrow="Supplier bill"
            title="BILL-2026-0042"
            subtitle="Berbera Cement Co. · Supplier ref BCC/INV/5531"
            axes={[
              { label: 'Document', value: <StatusPill tone="success">Approved</StatusPill> },
              { label: 'Posting', value: <StatusText tone="neutral">Not posted</StatusText> },
              { label: 'Match', value: <StatusText tone="danger">Exception</StatusText> },
            ]}
          />
          <Notice tone="attention" title="Posting is blocked by the purchase-order match">
            Line 1 bills 200 bags of Cement 42.5N but GRN-2026-0154 received 180. Approve the
            exception or mark it disputed before this bill can post.
          </Notice>
        </Specimen>
        <Specimen label="Supplier bill · Posted — Reverse sits in the kebab, in danger">
          <DocumentActionBar
            className="static"
            back={<Button variant="ghost" className="gap-1.5 px-2"><ArrowLeft size={16} aria-hidden="true" />Supplier bills</Button>}
            commands={[{ key: 'reverse', label: 'Reverse', onSelect: () => {}, destructive: true }]}
            lifecycle={<LifecycleStepper steps={STAGES} current="POSTED" />}
          />
        </Specimen>
        <Specimen label="Supplier bill · Reversed — a terminal state, no commands left">
          <DocumentActionBar
            className="static"
            back={<Button variant="ghost" className="gap-1.5 px-2"><ArrowLeft size={16} aria-hidden="true" />Supplier bills</Button>}
            lifecycle={<LifecycleStepper steps={STAGES} current="POSTED" terminal={{ label: 'Reversed', tone: 'historical' }} />}
          />
        </Specimen>
        <Specimen
          label="Document body — identity facts, tabs, totals and summary rail"
          token="<DocumentIdentity facts> · <DocumentTabs> · <TotalsBlock> · <SummaryRail>"
          note="Tabs keep a fixed order on every document. A tab the API cannot supply is left out rather than drawn empty — on the live bill page Approvals and Activity wait for their endpoints."
        >
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_17rem]">
            <div className="min-w-0">
              <DocumentIdentity
                eyebrow="Supplier bill"
                title="BILL-2026-0042"
                subtitle="Berbera Cement Co. · Supplier ref BCC/INV/5531"
                axes={[
                  { label: 'Document', value: <StatusPill tone="success">Approved</StatusPill> },
                  { label: 'Posting', value: <StatusText tone="success">Posted</StatusText> },
                  { label: 'Match', value: <StatusText tone="success">Matched</StatusText> },
                ]}
                facts={[
                  { label: 'Supplier', value: 'Berbera Cement Co.' },
                  { label: 'Supplier invoice', value: 'BCC/INV/5531' },
                  { label: 'Project', value: <a href="#document" className="font-medium text-brand-primary hover:underline">Hodan Mixed-Use Tower</a> },
                  { label: 'Purchase order', value: <a href="#document" className="font-medium text-brand-primary hover:underline">PO-2026-0311</a> },
                  { label: 'Bill date', value: '14 Sep 2026' },
                  { label: 'Due date', value: '14 Oct 2026' },
                ]}
              />
              <DocumentTabs
                label="Bill sections"
                tabs={[
                  {
                    key: 'lines',
                    label: 'Lines',
                    count: 3,
                    content: (
                      <div className="space-y-6">
                        <TableScroll aria-label="Bill lines">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Item</TableHead>
                                <TableHead>Expense profile</TableHead>
                                <TableHead numeric>Quantity</TableHead>
                                <TableHead numeric>Amount</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {[
                                ['Cement 42.5N', 'MAT-CEMENT', '200 bag', '1900.00'],
                                ['Rebar Y12', 'MAT-STEEL', '4.5 ton', '3510.00'],
                                ['Delivery to site', 'FREIGHT-IN', '1 trip', '250.00'],
                              ].map(([item, code, qty, amount]) => (
                                <TableRow key={item}>
                                  <TableCell className="font-medium">{item}</TableCell>
                                  <TableCell className="font-mono text-caption text-muted-foreground">{code}</TableCell>
                                  <TableCell numeric>{qty}</TableCell>
                                  <TableCell numeric><MoneyDisplay value={amount} /></TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TableScroll>
                        <TotalsBlock
                          className="ms-auto max-w-sm"
                          rows={[
                            { label: 'Subtotal', value: <MoneyDisplay value="5660.00" /> },
                            { label: 'Sales tax', value: <MoneyDisplay value="0" /> },
                          ]}
                          total={{ label: 'Total', value: <MoneyDisplay value="5660.00" /> }}
                          amountDue={{ label: 'Amount due', value: <MoneyDisplay value="5660.00" /> }}
                        />
                      </div>
                    ),
                  },
                  {
                    key: 'journal',
                    label: 'Journal items',
                    content: <p className="py-6 text-body-sm text-muted-foreground">Journal items are created when this bill is posted.</p>,
                  },
                  {
                    key: 'approvals',
                    label: 'Approvals',
                    count: 2,
                    content: (
                      <ApprovalTimeline
                        label="Approval history"
                        steps={[
                          { id: 'fm', title: 'Finance Manager', actor: 'Hodan Abdi', at: '15 Sep 2026, 09:12', state: 'approved', comment: 'Quantities checked against GRN-2026-0154.' },
                          { id: 'cd', title: 'Commercial Director', actor: 'Abdi Yusuf', state: 'current', condition: 'Bills from $5,000 to $25,000 need two approvals.' },
                        ]}
                      />
                    ),
                  },
                  {
                    key: 'activity',
                    label: 'Activity',
                    count: 3,
                    content: (
                      <ActivityTimeline
                        entries={[
                          { id: '3', actor: 'Hodan Abdi', summary: 'approved as Finance Manager', at: '15 Sep 2026, 09:12', code: 'bill.approve' },
                          { id: '2', actor: 'Faarax Nuur', summary: 'submitted the bill for approval', at: '14 Sep 2026, 10:20', code: 'bill.submit' },
                          { id: '1', actor: 'Faarax Nuur', summary: 'created the bill from PO-2026-0311', at: '14 Sep 2026, 10:05', code: 'bill.create' },
                        ]}
                      />
                    ),
                  },
                ]}
              />
            </div>
            <div className="space-y-4">
              <SummaryRail
                title="Payment summary"
                rows={[
                  { label: 'Balance due', value: <MoneyDisplay value="5660.00" /> },
                  { label: 'Due date', value: '14 Oct 2026' },
                  { label: 'Posted', value: '16 Sep 2026' },
                ]}
              />
              <TotalsBlock
                hidden
                rows={[]}
                total={{ label: 'Total', value: null }}
              />
            </div>
          </div>
        </Specimen>
        <Specimen label="Notice — one per document, when a state needs words" token="<Notice tone title action>">
          <div className="flex flex-col gap-3">
            <Notice tone="info">Journal items are created when this bill is posted.</Notice>
            <Notice tone="attention" title="Posting is blocked by the purchase-order match">
              Approve the exception or mark it disputed before this bill can post.
            </Notice>
            <Notice tone="danger" title="Posting failed" action={<Button variant="outline">Retry posting</Button>}>
              Fiscal period September 2026 is locked. Ask a Finance Manager to reopen it, then retry.
            </Notice>
            <Notice tone="historical" title="Posting reversed on 18 Sep 2026">
              JE-2026-0931 reversed JE-2026-0890. This bill and both journal entries are read-only.
            </Notice>
            <Notice tone="success" title="Bill posted">Posted to the general ledger as JE-2026-0890.</Notice>
          </div>
        </Specimen>
      </Section>
    </>
  );
}
