'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { ProjectStatus } from '@erp/types';
import {
  ActivityTimeline,
  Alert,
  Button,
  DefinitionList,
  DefinitionRow,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  LtrValue,
  RecordHeader,
  RecordLayout,
  RecordPanel,
  Skeleton,
  SkeletonRecord,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  type ActivityTimelineEntry,
} from '@erp/ui';
import { EllipsisVertical } from 'lucide-react';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { renderNextLink } from '@/components/render-next-link';
import { MetricStrip, type Metric } from '@/components/widget/metric-strip';
import { usePermissions } from '@/features/auth/permissions/can';
import { ProjectStatusBadge } from '@/features/projects/components/project-status-badge';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { countryName } from '@/lib/phone';

import { clientErrorCode } from '../client-errors';
import {
  useClient,
  useClientActivity,
  useClientOverview,
  useDeactivateClient,
  useReactivateClient,
} from '../hooks/use-client';
import {
  ClientStatus,
  type ClientDetail,
  type ClientOverview,
  type ClientOverviewMetrics,
  type CollectionStatus,
} from '../types';
import { ClientContacts } from './client-contacts';
import { ClientStatusBadge } from './client-status-badge';

type RecordT = ReturnType<typeof useTranslations<'platform.clients.record'>>;

const COLLECTION_TONE: Record<CollectionStatus, 'neutral' | 'attention' | 'danger'> = {
  CURRENT: 'neutral',
  DUE_SOON: 'attention',
  OVERDUE: 'danger',
};

const money = (value: string | null | undefined) => formatMoney(value, 'USD');

/**
 * The client record — one page, no tabs (clients redesign, 2026-10-02).
 *
 * Built on the shared record layout (`RecordLayout`: header · full-width strip · main panels ·
 * rail), so a supplier record can reuse the same frame with its own panels.
 *
 *   header   breadcrumbs, name, status, code · type · city; "New project" and a kebab
 *   strip    projects, contract value, outstanding, overdue — money roles with projects only
 *   main     Projects, Unpaid invoices (money roles), Contacts
 *   rail     Details, Latest activity
 *
 * Commands come from the server: Deactivate / Reactivate render only when `allowedCommands`
 * lists them, and a deactivation the rules block is explained in words instead.
 */
export function ClientRecord({ clientId }: { clientId: string }) {
  const t = useTranslations('platform.clients.record');
  const tNav = useTranslations('platform.nav');
  const tCommon = useTranslations('common');
  const clientQuery = useClient(clientId);
  const overviewQuery = useClientOverview(clientId);

  if (clientQuery.isPending) return <SkeletonRecord label={tCommon('loading')} />;
  if (clientQuery.isError) {
    const notFound =
      clientQuery.error instanceof ApiError &&
      (clientQuery.error.status === 404 || clientQuery.error.status === 403);
    return (
      <div className="space-y-4">
        <Breadcrumbs
          items={[
            { label: tNav('projects'), href: '/projects' },
            { label: tNav('clients'), href: '/clients' },
          ]}
        />
        <Alert variant="error" messages={[notFound ? t('notFound') : t('loadFailed')]}>
          {notFound ? null : (
            <div className="mt-3">
              <Button variant="outline" size="sm" onClick={() => void clientQuery.refetch()}>
                {t('retry')}
              </Button>
            </div>
          )}
        </Alert>
      </div>
    );
  }

  return <ClientRecordView client={clientQuery.data} overviewQuery={overviewQuery} />;
}

function ClientRecordView({
  client,
  overviewQuery,
}: {
  client: ClientDetail;
  overviewQuery: ReturnType<typeof useClientOverview>;
}) {
  const t = useTranslations('platform.clients.record');
  const tNav = useTranslations('platform.nav');
  const tTypes = useTranslations('platform.clients.create.clientTypes');
  const locale = useLocale();
  const { can } = usePermissions();
  const overview = overviewQuery.data;
  const hasNoProjects = overview !== undefined && overview.projects.length === 0;

  const meta = [
    <LtrValue key="code" as="code" className="font-mono text-caption">
      {client.code}
    </LtrValue>,
    client.type ? <span key="type">{tTypes(client.type)}</span> : null,
    client.city ? <span key="city">{client.city}</span> : null,
  ]
    .filter(Boolean)
    .flatMap((item, index) =>
      index === 0
        ? [item]
        : [
            <span key={`sep-${index}`} aria-hidden="true">
              ·
            </span>,
            item,
          ],
    );

  return (
    <RecordLayout
      header={
        <RecordHeader
          breadcrumb={
            <Breadcrumbs
              items={[
                { label: tNav('projects'), href: '/projects' },
                { label: tNav('clients'), href: '/clients' },
                { label: client.name },
              ]}
            />
          }
          title={client.name}
          statusPlacement="title"
          status={<ClientStatusBadge status={client.status} />}
          meta={meta}
          actions={<HeaderActions client={client} />}
        />
      }
      banner={
        overview?.metrics ? (
          <ClientMetrics metrics={overview.metrics} t={t} />
        ) : null
      }
      rail={
        <>
          <DetailsPanel client={client} canEdit={can('manage:client')} locale={locale} t={t} />
          <ActivityPanel clientId={client.id} t={t} locale={locale} />
        </>
      }
    >
      {overviewQuery.isPending ? (
        <RecordPanel title={t('projects.title')}>
          <div className="space-y-2" aria-hidden="true">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-4/5" />
            <Skeleton className="h-5 w-3/5" />
          </div>
        </RecordPanel>
      ) : overviewQuery.isError || !overview ? (
        <Alert variant="error" messages={[t('overviewFailed')]}>
          <div className="mt-3">
            <Button variant="outline" size="sm" onClick={() => void overviewQuery.refetch()}>
              {t('retry')}
            </Button>
          </div>
        </Alert>
      ) : (
        <>
          {/* No projects: one empty state in place of the projects table — but an unpaid invoice
              that belongs to no project (an opening balance, a one-off charge) still shows below. */}
          {hasNoProjects ? (
            <EmptyState
              title={t('projects.emptyTitle', { name: client.name })}
              description={t('projects.emptyHint')}
            />
          ) : (
            <ProjectsPanel overview={overview} t={t} />
          )}
          {overview.moneyVisible &&
          overview.unpaidInvoices &&
          overview.unpaidInvoices.length > 0 ? (
            <UnpaidInvoicesPanel
              clientId={client.id}
              invoices={overview.unpaidInvoices}
              canSeeAll={can('manage:receivable')}
              locale={locale}
              t={t}
            />
          ) : null}
        </>
      )}

      <ClientContacts
        clientId={client.id}
        contacts={client.contacts}
        canManage={can('manage:client')}
      />
    </RecordLayout>
  );
}

// ─── Header actions ───────────────────────────────────────────────────────────

function HeaderActions({ client }: { client: ClientDetail }) {
  const t = useTranslations('platform.clients.record');
  const tErrors = useTranslations('platform.clients.errors');
  const { can } = usePermissions();
  const [confirming, setConfirming] = useState<'DEACTIVATE' | 'REACTIVATE' | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const deactivate = useDeactivateClient(client.id);
  const reactivate = useReactivateClient(client.id);

  const isActive = client.status === ClientStatus.ACTIVE;
  const allowed = client.allowedCommands ?? [];
  const mayEdit = can('manage:client');
  const blockedBy =
    isActive && mayEdit && !allowed.includes('DEACTIVATE')
      ? (client.deactivationBlockedBy ?? null)
      : null;
  const hasMenu = mayEdit || allowed.length > 0 || blockedBy !== null;

  const commandError = (error: unknown) => {
    const code = clientErrorCode(error);
    return code ? tErrors(code) : t('statusChangeFailed');
  };
  const deactivateError =
    reasonError ?? (deactivate.isError ? commandError(deactivate.error) : undefined);

  const close = () => {
    deactivate.reset();
    reactivate.reset();
    setReasonError(null);
    setConfirming(null);
  };

  return (
    <>
      {can('create:project') && isActive ? (
        <Button asChild>
          <Link href={`/projects/new?clientId=${client.id}`}>{t('newProject')}</Link>
        </Button>
      ) : null}
      {hasMenu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label={t('more')}>
              <EllipsisVertical size={20} aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-w-72">
            {mayEdit ? (
              <DropdownMenuItem asChild>
                <Link href={`/clients/${client.id}/edit`}>{t('edit')}</Link>
              </DropdownMenuItem>
            ) : null}
            {allowed.includes('DEACTIVATE') ? (
              <>
                {mayEdit ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem destructive onSelect={() => setConfirming('DEACTIVATE')}>
                  {t('deactivate')}
                </DropdownMenuItem>
              </>
            ) : null}
            {allowed.includes('REACTIVATE') ? (
              <>
                {mayEdit ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem onSelect={() => setConfirming('REACTIVATE')}>
                  {t('reactivate')}
                </DropdownMenuItem>
              </>
            ) : null}
            {blockedBy ? (
              <>
                <DropdownMenuSeparator />
                <div role="note" className="px-2 py-1.5 text-caption text-muted-foreground">
                  <p className="font-medium text-foreground">{t('deactivateBlockedTitle')}</p>
                  <p className="mt-0.5">{t(`deactivateBlocked.${blockedBy}`)}</p>
                </div>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {confirming === 'DEACTIVATE' ? (
        <ConfirmActionDialog
          title={t('deactivateTitle', { name: client.name })}
          description={t('deactivateBody')}
          confirmLabel={t('deactivateConfirm')}
          destructive
          reason={{
            required: true,
            label: t('reasonLabel'),
            hint: t('reasonHint'),
            maxLength: 500,
          }}
          isPending={deactivate.isPending}
          errorMessage={deactivateError}
          onConfirm={(reason) => {
            if (reason.length < 3) {
              setReasonError(t('reasonTooShort'));
              return;
            }
            setReasonError(null);
            deactivate.mutate(reason, { onSuccess: close });
          }}
          onDismiss={close}
        />
      ) : null}
      {confirming === 'REACTIVATE' ? (
        <ConfirmActionDialog
          title={t('reactivateTitle', { name: client.name })}
          description={t('reactivateBody')}
          confirmLabel={t('reactivate')}
          isPending={reactivate.isPending}
          errorMessage={reactivate.isError ? commandError(reactivate.error) : undefined}
          onConfirm={() => reactivate.mutate(undefined, { onSuccess: close })}
          onDismiss={close}
        />
      ) : null}
    </>
  );
}

// ─── Metric strip ─────────────────────────────────────────────────────────────

function ClientMetrics({ metrics, t }: { metrics: ClientOverviewMetrics; t: RecordT }) {
  const overdue = Number(metrics.overdue) > 0;
  const overdueParts = [
    metrics.overdueDays !== null ? t('metrics.overdueDays', { count: metrics.overdueDays }) : null,
    metrics.oldestOverdueInvoice?.invoiceNumber ?? null,
  ].filter(Boolean);
  const items: Metric[] = [
    {
      label: t('metrics.projects'),
      value: t('metrics.projectsActive', { count: metrics.activeProjectCount }),
      sublabel: t('metrics.projectsTotal', { count: metrics.totalProjectCount }),
    },
    {
      label: t('metrics.contractValue'),
      value: money(metrics.activeContractValue),
      sublabel: t('metrics.contractValueHint'),
    },
    {
      label: t('metrics.outstanding'),
      value: money(metrics.outstanding),
      sublabel: t('metrics.unpaidInvoices', { count: metrics.unpaidInvoiceCount }),
    },
    {
      label: t('metrics.overdue'),
      value: money(metrics.overdue),
      ...(overdue && overdueParts.length > 0
        ? { sublabel: overdueParts.join(' · '), sublabelTone: 'danger' as const }
        : {}),
    },
  ];
  return <MetricStrip aria-label={t('metrics.label')} columns={4} metrics={items} />;
}

// ─── Main panels ──────────────────────────────────────────────────────────────

function ProjectsPanel({ overview, t }: { overview: ClientOverview; t: RecordT }) {
  const showMoney = overview.moneyVisible;
  return (
    <RecordPanel title={t('projects.title')} padded={false}>
      <TableScroll aria-label={t('projects.title')} className="rounded-none border-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('projects.project')}</TableHead>
              <TableHead>{t('projects.status')}</TableHead>
              {showMoney ? <TableHead numeric>{t('projects.contractValue')}</TableHead> : null}
              {showMoney ? <TableHead numeric>{t('projects.outstanding')}</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {overview.projects.map((project) => (
              <TableRow key={project.id}>
                <TableCell>
                  <Link
                    href={`/projects/${project.id}`}
                    className="font-medium text-brand-primary underline-offset-2 hover:underline"
                  >
                    {project.name}
                  </Link>
                  <LtrValue
                    as="code"
                    className="block font-mono text-caption text-muted-foreground"
                  >
                    {project.code}
                  </LtrValue>
                </TableCell>
                <TableCell>
                  <ProjectStatusBadge status={project.status as ProjectStatus} />
                </TableCell>
                {showMoney ? (
                  <TableCell numeric>{money(project.contractValue) ?? '—'}</TableCell>
                ) : null}
                {showMoney ? (
                  <TableCell numeric>
                    {project.outstanding !== null && Number(project.outstanding) > 0
                      ? money(project.outstanding)
                      : '—'}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableScroll>
      {showMoney ? null : (
        <p className="border-t border-border px-4 py-2.5 text-caption text-muted-foreground">
          {t('moneyHidden')}
        </p>
      )}
    </RecordPanel>
  );
}

function UnpaidInvoicesPanel({
  clientId,
  invoices,
  canSeeAll,
  locale,
  t,
}: {
  clientId: string;
  invoices: NonNullable<ClientOverview['unpaidInvoices']>;
  canSeeAll: boolean;
  locale: string;
  t: RecordT;
}) {
  return (
    <RecordPanel
      title={t('invoices.title')}
      padded={false}
      action={
        canSeeAll ? (
          <Link
            href={`/finance/accounting/invoices?clientId=${clientId}`}
            className="text-body-sm font-medium text-brand-primary underline-offset-2 hover:underline"
          >
            {t('invoices.all')}
          </Link>
        ) : undefined
      }
    >
      <TableScroll aria-label={t('invoices.title')} className="rounded-none border-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('invoices.invoice')}</TableHead>
              <TableHead>{t('invoices.due')}</TableHead>
              <TableHead numeric>{t('invoices.balance')}</TableHead>
              <TableHead>{t('invoices.collection')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map((invoice) => (
              <TableRow key={invoice.id}>
                <TableCell>
                  <Link
                    href={`/finance/accounting/invoices/${invoice.id}`}
                    className="font-medium text-brand-primary underline-offset-2 hover:underline"
                  >
                    {invoice.invoiceNumber ?? t('invoices.unnumbered')}
                  </Link>
                  {invoice.projectName ? (
                    <span className="block text-caption text-muted-foreground">
                      {invoice.projectName}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell>
                  {formatDate(invoice.dueDate, locale as 'en') ?? t('invoices.noDueDate')}
                </TableCell>
                <TableCell numeric>{money(invoice.balance)}</TableCell>
                <TableCell>
                  <StatusPill tone={COLLECTION_TONE[invoice.collectionStatus]}>
                    {t(`invoices.status.${invoice.collectionStatus}`)}
                  </StatusPill>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableScroll>
    </RecordPanel>
  );
}

// ─── Rail ─────────────────────────────────────────────────────────────────────

function DetailsPanel({
  client,
  canEdit,
  locale,
  t,
}: {
  client: ClientDetail;
  canEdit: boolean;
  locale: string;
  t: RecordT;
}) {
  const notRecorded = t('details.notRecorded');
  const address = [client.address, client.city, countryName(client.countryCode, locale)]
    .filter(Boolean)
    .join(', ');
  return (
    <RecordPanel
      title={t('details.title')}
      action={
        canEdit ? (
          <Link
            href={`/clients/${client.id}/edit`}
            className="text-body-sm font-medium text-brand-primary underline-offset-2 hover:underline"
          >
            {t('details.edit')}
          </Link>
        ) : undefined
      }
    >
      <DefinitionList>
        <DefinitionRow label={t('details.registrationNumber')} emptyText={notRecorded}>
          {client.registrationNumber || null}
        </DefinitionRow>
        <DefinitionRow label={t('details.taxId')} emptyText={notRecorded}>
          {client.taxNumber || null}
        </DefinitionRow>
        <DefinitionRow label={t('details.address')} emptyText={notRecorded}>
          {address || null}
        </DefinitionRow>
        <DefinitionRow label={t('details.paymentTerms')} emptyText={notRecorded}>
          {client.paymentTermsDays === null || client.paymentTermsDays === undefined
            ? null
            : t('details.netDays', { days: client.paymentTermsDays })}
        </DefinitionRow>
        <DefinitionRow label={t('details.invoiceEmail')} emptyText={notRecorded}>
          {client.invoiceEmail ? (
            <a
              href={`mailto:${client.invoiceEmail}`}
              dir="ltr"
              className="text-brand-primary underline-offset-2 hover:underline"
            >
              {client.invoiceEmail}
            </a>
          ) : null}
        </DefinitionRow>
        <DefinitionRow label={t('details.clientSince')} emptyText={notRecorded}>
          {formatDate(client.createdAt, locale as 'en')}
        </DefinitionRow>
      </DefinitionList>
    </RecordPanel>
  );
}

function ActivityPanel({ clientId, t, locale }: { clientId: string; t: RecordT; locale: string }) {
  const activity = useClientActivity(clientId, 10);
  const entries: ActivityTimelineEntry[] = (activity.data ?? []).map((entry) => ({
    id: entry.id,
    actor: entry.actorName,
    action: entry.summary,
    at: formatDateTime(entry.at, locale as 'en') ?? entry.at,
    dateTime: entry.at,
  }));
  return (
    <RecordPanel title={t('activity.title')}>
      {activity.isPending ? (
        <div className="space-y-2" aria-hidden="true">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : activity.isError ? (
        <p className="text-body-sm text-muted-foreground">{t('activity.failed')}</p>
      ) : (
        <ActivityTimeline
          compact
          label={t('activity.title')}
          entries={entries}
          renderLink={renderNextLink}
          empty={<p className="text-body-sm text-muted-foreground">{t('activity.empty')}</p>}
        />
      )}
    </RecordPanel>
  );
}
