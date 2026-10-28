'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Avatar,
  Button,
  cn,
  entityTintClass,
  StatusPill,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  type FilterValues,
  type ListFilterField,
  MoneyDisplay,
  OverflowGlyph,
  RowActions,
  useToast,
} from '@erp/ui';
import { FileText, Plus } from 'lucide-react';

import {
  PlatformDataGrid,
  searchRows,
  type GridColumn,
  type SortState,
} from '@/components/platform-data-grid';
import { ListViewsBar, type BuiltInView } from '@/features/saved-views/components/list-views-bar';
import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { useClients } from '@/features/clients/hooks/use-clients';
import { ListPageHeader } from '@/components/layout/list-page-header';
import { formatDate, formatMoney } from '@/lib/format';
import { fromMinorUnits } from '@/lib/money';

import { useProjectFilter } from '@/features/projects/hooks/use-project-filter';

import { useInvoices, useOpenInvoiceDocument } from '../hooks/use-invoices';
import { isInvoiceOverdue, todayWireDate } from '../invoice-overdue';
import { daysLate, INVOICE_LIST_STATE_TONE, invoiceListState } from '../invoice-list-state';
import { useProjects } from '@/features/projects/hooks/use-projects';
import { toMinorUnits } from '@/lib/money';
import type { ClientInvoice, InvoiceDocStatus, PostingStatus } from '../types';
import type { SavedViewState } from '@erp/types';
import { InvoiceSummaryTiles } from './invoice-summary-tiles';
import { invoiceSummary } from '../invoice-summary';

const DOC_STATUSES: InvoiceDocStatus[] = ['DRAFT', 'APPROVED', 'CANCELLED'];
const POSTING_STATUSES: PostingStatus[] = ['NOT_POSTED', 'PENDING', 'POSTED', 'REVERSED', 'FAILED'];

const detailHref = (invoice: ClientInvoice) => `/finance/accounting/invoices/${invoice.id}`;

const DEFAULT_SORT: SortState = { key: 'dueDate', direction: 'desc' };

/** Whether an invoice passes the list's filters (`project` is applied by the API query). */
export function invoiceMatchesFilters(
  inv: ClientInvoice,
  filters: FilterValues,
  today: string,
): boolean {
  if (filters.status && inv.documentStatus !== filters.status) return false;
  if (filters.posting && inv.postingStatus !== filters.posting) return false;
  if (filters.client && inv.clientId !== filters.client) return false;
  if (filters.due === 'overdue' && !isInvoiceOverdue(inv, today)) return false;
  if (filters.due === 'notOverdue' && isInvoiceOverdue(inv, today)) return false;
  return true;
}

/**
 * The client invoice list (ADR-035 list page, ADR-036 pilot).
 *
 * "New invoice" opens a source picker, not a blank form (ADR-037): there is no blank create
 * endpoint — an invoice is raised from a certified IPC, a billing milestone or a separate charge,
 * and its amount is copied from that source. The action is shown only to holders of
 * `manage:receivable`, which every create endpoint requires.
 */
export function InvoicesList() {
  const t = useTranslations('accounting.invoices');
  const tGrid = useTranslations('common.grid');
  const { toast } = useToast();
  const openDocument = useOpenInvoiceDocument();
  const { can } = usePermissions();
  const createAction = can(ACCOUNTING_PERMISSIONS.manageReceivables) ? (
    <Button asChild>
      <Link href="/finance/accounting/invoices/new" data-shortcut-new="">
        <Plus size={16} aria-hidden="true" />
        {t('newInvoice')}
        <kbd
          className="hidden rounded border border-white/40 px-1 font-mono text-micro md:inline"
          aria-hidden="true"
        >
          N
        </kbd>
      </Link>
    </Button>
  ) : null;

  const projectFilter = useProjectFilter();
  // "All invoices" on a client record links here with `?clientId=`.
  const initialClientId = useSearchParams()?.get('clientId') ?? undefined;
  const [filters, setFilters] = useState<FilterValues>(() => {
    const initial: FilterValues = {};
    if (projectFilter.initialProjectId) initial.project = projectFilter.initialProjectId;
    if (initialClientId) initial.client = initialClientId;
    return initial;
  });
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortState | null>(DEFAULT_SORT);
  const invoices = useInvoices({ projectId: filters.project || undefined });
  // Joined here because `GET /invoices` embeds no client relation.
  const clients = useClients();
  const today = todayWireDate();

  const clientNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const client of clients.data ?? []) map.set(client.id, client.name);
    return map;
  }, [clients.data]);

  const projects = useProjects();
  const projectNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const project of projects.data ?? []) map.set(project.id, project.name);
    return map;
  }, [projects.data]);
  const projectName = (inv: ClientInvoice) =>
    inv.projectId ? (projectNames.get(inv.projectId) ?? null) : null;
  const paidPercent = (inv: ClientInvoice) => {
    const total = toMinorUnits(inv.totalAmount, 2);
    return total > 0
      ? Math.round(((total - toMinorUnits(inv.outstandingAmount, 2)) / total) * 100)
      : 0;
  };
  const all = useMemo(() => invoices.data ?? [], [invoices.data]);
  const visible = useMemo(
    () => all.filter((inv) => invoiceMatchesFilters(inv, filters, today)),
    [all, filters, today],
  );

  // Client options are the clients that have invoices — never an option that can only empty the list.
  const clientOptions = useMemo(() => {
    const ids = new Set(all.map((inv) => inv.clientId));
    return [...ids]
      .map((id) => ({ value: id, label: clientNames.get(id) ?? id.slice(-8) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [all, clientNames]);

  const filterFields: ListFilterField[] = [
    {
      key: 'status',
      type: 'select',
      label: t('filterByStatus'),
      options: DOC_STATUSES.map((s) => ({ value: s, label: t(`docStatus.${s}`) })),
    },
    {
      key: 'posting',
      type: 'select',
      label: t('filterByPostingStatus'),
      options: POSTING_STATUSES.map((s) => ({ value: s, label: t(`postingStatus.${s}`) })),
    },
    {
      key: 'due',
      type: 'select',
      label: t('filterByDue'),
      options: [
        { value: 'overdue', label: t('dueFilter.overdue') },
        { value: 'notOverdue', label: t('dueFilter.notOverdue') },
      ],
    },
    { key: 'client', type: 'select', label: t('colClient'), options: clientOptions },
    { key: 'project', type: 'select', label: t('filterByProject'), options: projectFilter.options },
  ];

  const sourceText = (invoice: ClientInvoice) => {
    // An API older than the list's `source` (or any row missing it) reads as "no source" rather
    // than taking the whole page down.
    const source = invoice.source ?? { kind: 'NONE' as const, label: null };
    const kind = t(`sourceKind.${source.kind}`);
    return source.label ? `${kind} · ${source.label}` : kind;
  };

  const columns: GridColumn<ClientInvoice>[] = [
    {
      key: 'number',
      header: t('colInvoice'),
      sticky: true,
      sortable: true,
      card: 'title',
      plainValue: (inv) => `${inv.invoiceNumber ?? ''} ${sourceText(inv)}`,
      exportValue: (inv) => `${inv.invoiceNumber ?? t('unnumbered')} (${sourceText(inv)})`,
      // The invoice number is the row's one link (the grid wraps this cell); the source says
      // what was billed — a certificate, a milestone, a separate charge.
      render: (inv) => (
        <span className="block">
          <span className="block font-mono text-body-sm font-semibold text-brand-primary">
            {inv.invoiceNumber ?? t('unnumbered')}
          </span>
          <span className="block max-w-[16rem] truncate text-caption font-normal text-muted-foreground">
            {sourceText(inv)}
          </span>
        </span>
      ),
    },
    {
      key: 'client',
      header: t('colClientProject'),
      sortable: true,
      card: 'subtitle',
      plainValue: (inv) =>
        `${clientNames.get(inv.clientId) ?? ''} ${projectName(inv) ?? ''}`.trim(),
      exportValue: (inv) => clientNames.get(inv.clientId) ?? '',
      render: (inv) => {
        const name = clientNames.get(inv.clientId) ?? inv.clientId.slice(-8);
        const project = projectName(inv);
        return (
          <span className="flex items-center gap-2.5">
            <Avatar
              name={name}
              size="sm"
              className={cn('rounded-control ring-0', entityTintClass(inv.clientId))}
            />
            <span className="min-w-0">
              <span className="block max-w-[16rem] truncate font-medium">{name}</span>
              {project ? (
                <span className="block max-w-[16rem] truncate text-caption text-muted-foreground">
                  {project}
                </span>
              ) : null}
            </span>
          </span>
        );
      },
    },
    {
      key: 'issued',
      header: t('colIssued'),
      sortable: true,
      plainValue: (inv) => inv.invoiceDate ?? '',
      render: (inv, ctx) => (
        <span className="whitespace-nowrap">{formatDate(inv.invoiceDate, ctx.locale)}</span>
      ),
    },
    {
      key: 'dueDate',
      header: t('colDueDate'),
      sortable: true,
      card: 'meta',
      plainValue: (inv) => inv.dueDate ?? '',
      render: (inv, ctx) =>
        inv.dueDate ? (
          <span className="whitespace-nowrap">
            {formatDate(inv.dueDate, ctx.locale)}
            {daysLate(inv, today) > 0 ? (
              <span className="font-medium text-danger">
                {' '}
                · {t('daysLate', { days: daysLate(inv, today) })}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'total',
      header: t('colTotal'),
      numeric: true,
      sortable: true,
      card: 'amount',
      plainValue: (inv) => Number(inv.totalAmount),
      render: (inv) => <MoneyDisplay value={inv.totalAmount} />,
    },
    {
      key: 'outstanding',
      header: t('colBalanceDue'),
      numeric: true,
      sortable: true,
      plainValue: (inv) => Number(inv.outstandingAmount),
      // A cancelled or reversed invoice owes nothing, and a zero there would read as "paid".
      render: (inv) =>
        inv.documentStatus === 'CANCELLED' || inv.postingStatus === 'REVERSED' ? (
          <MoneyDisplay value={null} />
        ) : (
          <span className="inline-flex items-center justify-end gap-2">
            <span
              className={cn(
                'font-semibold',
                invoiceListState(inv, today) === 'OVERDUE' && 'text-danger',
              )}
            >
              <MoneyDisplay value={inv.outstandingAmount} />
            </span>
            {invoiceListState(inv, today) === 'PART_PAID' ? (
              // How much is collected, as a bar — the figure beside it is the authority.
              <svg
                viewBox="0 0 100 6"
                preserveAspectRatio="none"
                className="hidden h-1.5 w-14 overflow-hidden rounded-full lg:block"
                aria-hidden="true"
              >
                <rect width="100" height="6" rx="3" className="fill-muted" />
                <rect width={paidPercent(inv)} height="6" rx="3" className="fill-success" />
              </svg>
            ) : null}
          </span>
        ),
    },
    {
      key: 'status',
      header: t('colStatus'),
      card: 'status',
      plainValue: (inv) => t(`listState.${invoiceListState(inv, today)}`),
      render: (inv) => (
        <span className="flex flex-col items-start gap-1">
          <StatusPill tone={INVOICE_LIST_STATE_TONE[invoiceListState(inv, today)]}>
            {t(`listState.${invoiceListState(inv, today)}`)}
          </StatusPill>
        </span>
      ),
    },
  ];

  // Step 2a (ADR-047): views. A view's count is how many invoices its filters and search keep; the project
  // filter is the API's, so a count is only shown while the view's project matches the loaded one.
  const countFor = (state: SavedViewState): number | undefined => {
    const f = state.filters ?? {};
    if ((f.project ?? '') !== (filters.project ?? '')) return undefined;
    const filtered = all.filter((inv) => invoiceMatchesFilters(inv, f, today));
    return searchRows(filtered, state.search ?? '', columns).length;
  };
  const builtInViews: Omit<BuiltInView, 'count'>[] = [
    { id: 'all', label: t('views.all'), state: { sort: DEFAULT_SORT } },
    {
      id: 'overdue',
      label: t('views.overdue'),
      state: { filters: { due: 'overdue' }, sort: { key: 'dueDate', direction: 'asc' } },
    },
    {
      id: 'drafts',
      label: t('views.drafts'),
      state: { filters: { status: 'DRAFT' }, sort: DEFAULT_SORT },
    },
    {
      id: 'toPost',
      label: t('views.toPost'),
      state: { filters: { status: 'APPROVED', posting: 'NOT_POSTED' }, sort: DEFAULT_SORT },
    },
  ];
  // The summary follows the project filter (the API's) but not the other filters: it is the
  // overview of the whole receivables book the list is drilling into.
  const summary = invoiceSummary(all, today);
  const builtIns: BuiltInView[] = builtInViews.map((v) => ({ ...v, count: countFor(v.state) }));
  const currentState: SavedViewState = { search, filters: filters as Record<string, string>, sort };
  const applyView = (state: SavedViewState) => {
    setSearch(state.search ?? '');
    setFilters({ ...(state.filters ?? {}) });
    setSort(state.sort ?? null);
  };

  const copyLink = async (invoice: ClientInvoice) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${detailHref(invoice)}`);
      toast({ title: t('linkCopied'), tone: 'success' });
    } catch {
      toast({ title: t('linkCopyFailed'), tone: 'error' });
    }
  };

  const headerSummary =
    all.length === 0
      ? undefined
      : summary.mixedCurrencies
        ? t('headerCount', { count: all.length })
        : t('headerSummary', {
            count: all.length,
            billed:
              formatMoney(fromMinorUnits(summary.billedThisYear.totalMinor, 2), summary.currency) ??
              '—',
          });

  return (
    <div className="space-y-5">
      <ListPageHeader
        eyebrow={t('eyebrow')}
        title={t('pageTitle')}
        summary={headerSummary}
        actions={createAction ?? undefined}
      />
      <PlatformDataGrid
        columns={columns}
        data={visible}
        rowKey={(invoice) => invoice.id}
        label={t('title')}
        isLoading={invoices.isPending}
        isError={invoices.isError}
        onRetry={() => void invoices.refetch()}
        errorMessage={t('loadFailed')}
        rowHref={detailHref}
        rowActions={(invoice) => (
          <RowActions
            overflow={
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('rowMenu', { number: invoice.invoiceNumber ?? t('unnumbered') })}
                  >
                    <OverflowGlyph />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <Link href={detailHref(invoice)}>{t('rowOpen')}</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      openDocument.mutate(invoice.id, {
                        onError: () => toast({ title: t('viewDocumentFailed'), tone: 'error' }),
                      })
                    }
                  >
                    {t('rowOpenPdf')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void copyLink(invoice)}>
                    {t('rowCopyLink')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            }
          />
        )}
        emptyState={
          all.length === 0 ? (
            <EmptyState
              icon={<FileText size={20} aria-hidden="true" />}
              title={t('empty')}
              description={t('emptyHint')}
              action={createAction ?? undefined}
            />
          ) : undefined
        }
        noMatchMessage={t('noMatches')}
        resultLabel={(count) => t('countLabel', { count })}
        pagination={{ defaultPageSize: 25 }}
        listState={{ search, onSearchChange: setSearch, sort, onSortChange: setSort }}
        shortcuts={{
          // Follows the visible "New invoice" link, so N and the button can never go to different places.
          onNew: createAction
            ? () => document.querySelector<HTMLAnchorElement>('a[data-shortcut-new]')?.click()
            : undefined,
        }}
        exportAs={{ fileName: `invoices-${today}`, sheetName: t('title') }}
        summary={
          all.length > 0 ? (
            <InvoiceSummaryTiles
              summary={summary}
              onShowDrafts={() => applyView(builtInViews[2]!.state)}
              onShowOverdue={() => applyView(builtInViews[1]!.state)}
              onShowNotDue={() =>
                applyView({
                  filters: { status: 'APPROVED', posting: 'POSTED', due: 'notOverdue' },
                  sort: { key: 'dueDate', direction: 'asc' },
                })
              }
            />
          ) : undefined
        }
        savedViews={
          <ListViewsBar
            listKey="invoices"
            builtIns={builtIns}
            current={currentState}
            onApply={applyView}
            countFor={countFor}
            label={t('views.label')}
          />
        }
        searchPlaceholder={t('searchPlaceholder')}
        searchLabel={tGrid('searchLabel')}
        filters={filterFields}
        filterValues={filters}
        onFilterValuesChange={setFilters}
      />
    </div>
  );
}
