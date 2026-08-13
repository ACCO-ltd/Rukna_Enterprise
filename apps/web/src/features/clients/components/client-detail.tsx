'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ClientStatus } from '@erp/types';
import { Alert, Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@erp/ui';
import { DotsThreeVertical } from '@phosphor-icons/react';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { ApiError } from '@/lib/api-client';
import { formatMoney } from '@/lib/format';
import { useProjects } from '@/features/projects/hooks/use-projects';
import { ProjectStatusBadge } from '@/features/projects/components/project-status-badge';
import { usePermissions } from '@/features/auth/permissions/can';

import { useClient, useSetClientStatus } from '../hooks/use-client';
import { useClientSummaries } from '../hooks/use-clients';
import { ClientContacts } from './client-contacts';
import { ClientStatusBadge } from './client-status-badge';

type Section = 'overview' | 'projects' | 'activity';

export function ClientDetail({ clientId }: { clientId: string }) {
  const t = useTranslations('platform.clients.detail');
  const tClients = useTranslations('platform.clients');
  const tCreate = useTranslations('platform.clients.create');
  const tCommon = useTranslations('common');
  const searchParams = useSearchParams();
  const clientQuery = useClient(clientId);
  const summaries = useClientSummaries();
  const update = useSetClientStatus(clientId);
  const { can } = usePermissions();
  const [confirmingStatus, setConfirmingStatus] = useState(false);
  const [section, setSection] = useState<Section>(searchParams.get('tab') === 'projects' ? 'projects' : 'overview');

  if (clientQuery.isPending) {
    return <div role="status" aria-live="polite"><span className="sr-only">{tCommon('loading')}</span><div className="h-64 animate-pulse rounded-panel border border-border bg-muted" aria-hidden="true" /></div>;
  }
  if (clientQuery.isError) {
    const notFound = clientQuery.error instanceof ApiError && clientQuery.error.status === 404;
    return <div className="space-y-4"><Alert variant="error" messages={[notFound ? t('notFound') : t('loadFailed')]} /><Button variant="outline" asChild><Link href="/clients">{t('back')}</Link></Button></div>;
  }

  const client = clientQuery.data;
  const isActive = client.status === ClientStatus.ACTIVE;
  const contact = client.contacts.find((item) => item.isPrimary) ?? client.contacts[0];
  const summary = summaries.data?.find((item) => item.id === client.id);

  return (
    <div className="space-y-7">
      <header>
        <Link href="/clients" className="text-sm text-muted-foreground underline-offset-4 hover:underline">{t('back')}</Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-foreground">{client.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="font-mono text-xs">{client.code}</span><span aria-hidden="true">·</span>
              <span>{client.type ? tCreate(`clientTypes.${client.type}`) : tClients('notSet')}</span><span aria-hidden="true">·</span>
              <ClientStatusBadge status={client.status} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {can('create:project') ? <Button asChild><Link href={`/projects/new?clientId=${client.id}`}>{t('newProject')}</Link></Button> : null}
            {can('manage:client') ? <Button variant="outline" asChild><Link href={`/clients/${client.id}/edit`}>{t('edit')}</Link></Button> : null}
            {can('manage:client') ? <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="outline" size="icon" aria-label={t('more')}><DotsThreeVertical size={20} aria-hidden="true" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => setConfirmingStatus(true)}>{isActive ? t('deactivate') : t('reactivate')}</DropdownMenuItem></DropdownMenuContent>
            </DropdownMenu> : null}
          </div>
        </div>
      </header>

      {searchParams.get('contact') === 'needs-attention' ? <Alert variant="info" messages={[t('contactNeedsAttention')]} /> : null}

      <section className="grid overflow-hidden rounded-panel border border-border bg-surface sm:grid-cols-2" aria-label={t('summary')}>
        <SummaryMetric label={t('activeProjects')} value={summary ? String(summary.activeProjectCount) : '—'} />
        <SummaryMetric label={t('outstandingBalance')} value={summary?.outstandingBalance === null ? tClients('restricted') : (formatMoney(summary?.outstandingBalance, 'USD') ?? '—')} />
      </section>

      <section className="rounded-panel border border-border bg-surface px-4 sm:px-6">
        <nav className="flex gap-5 overflow-x-auto border-b border-border" aria-label={t('sections')}>
          <TabButton active={section === 'overview'} onClick={() => setSection('overview')}>{t('overview')}</TabButton>
          <TabButton active={section === 'projects'} onClick={() => setSection('projects')}>{t('projects')}</TabButton>
          <TabButton active={section === 'activity'} onClick={() => setSection('activity')}>{t('activity')}</TabButton>
        </nav>
        <div className="py-5">
          {section === 'overview' ? (
            <div>
              <h2 className="text-sm font-semibold text-foreground">{t('overview')}</h2>
              <dl className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-3">
                <Info label={t('primaryContact')} value={contact?.name} />
                <Info label={t('phone')} value={contact?.phone} dir="ltr" />
                <Info label={t('email')} value={contact?.email} dir="ltr" />
                {client.notes ? <div className="sm:col-span-3"><dt className="text-xs text-muted-foreground">{t('notes')}</dt><dd className="mt-1 whitespace-pre-line text-sm text-foreground">{client.notes}</dd></div> : null}
              </dl>
            </div>
          ) : section === 'projects' ? <ClientProjects clientId={client.id} /> : <p className="text-sm text-muted-foreground">{t('activityEmpty')}</p>}
        </div>
      </section>

      <ClientContacts clientId={client.id} contacts={client.contacts} canManage={can('manage:client')} />

      {confirmingStatus ? <ConfirmActionDialog title={isActive ? t('deactivateTitle') : t('reactivateTitle')} description={isActive ? t('deactivateBody') : t('reactivateBody')} confirmLabel={isActive ? t('deactivate') : t('reactivate')} isPending={update.isPending} errorMessage={update.isError ? t('statusChangeFailed') : undefined} onConfirm={() => update.mutate(isActive ? ClientStatus.INACTIVE : ClientStatus.ACTIVE, { onSuccess: () => setConfirmingStatus(false) })} onDismiss={() => { update.reset(); setConfirmingStatus(false); }} /> : null}
    </div>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) { return <div className="border-b border-border px-5 py-4 last:border-b-0 sm:border-b-0 sm:border-e sm:last:border-e-0"><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{value}</p></div>; }
function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button type="button" onClick={onClick} className={`min-h-12 shrink-0 border-b-2 text-sm font-medium ${active ? 'border-brand-primary text-brand-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>{children}</button>; }
function Info({ label, value, dir }: { label: string; value?: string | null; dir?: 'ltr' }) { const t = useTranslations('platform.clients'); return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-all text-sm text-foreground" dir={dir}>{value || <span className="text-muted-foreground">{t('notSet')}</span>}</dd></div>; }

function ClientProjects({ clientId }: { clientId: string }) {
  const t = useTranslations('platform.clients.detail');
  const projects = useProjects();
  const rows = (projects.data ?? []).filter((project) => project.clientId === clientId);
  if (projects.isPending) return <div className="h-20 animate-pulse rounded bg-muted" aria-hidden="true" />;
  if (projects.isError) return <Alert variant="error" messages={[t('projectsLoadFailed')]} />;
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{t('noProjects')}</p>;
  return <ul className="divide-y divide-border">{rows.map((project) => <li key={project.id}><Link href={`/projects/${project.id}`} className="flex min-h-14 items-center justify-between gap-3 text-sm hover:bg-surface-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"><span className="min-w-0 truncate"><span className="font-mono text-xs text-muted-foreground">{project.code}</span><span className="ms-2 font-medium text-foreground">{project.name}</span></span><ProjectStatusBadge status={project.status} /></Link></li>)}</ul>;
}
