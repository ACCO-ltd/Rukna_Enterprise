'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ClientStatus } from '@erp/types';
import { Button, Label, Select } from '@erp/ui';
import { FunnelSimple } from '@phosphor-icons/react';

import { EmptyState } from '@/components/empty-state';
import { PlatformDataGrid, type GridColumn } from '@/components/platform-data-grid';
import { formatMoney } from '@/lib/format';

import { useClientSummaries } from '../hooks/use-clients';
import { CLIENT_STATUS_ORDER, type ClientListItem } from '../types';
import { ClientStatusBadge } from './client-status-badge';

function buildColumns(t: ReturnType<typeof useTranslations<'platform.clients'>>): GridColumn<ClientListItem>[] {
  return [
    {
      key: 'client', header: t('columns.client'), sticky: true, sortable: true,
      plainValue: (client) => client.name,
      render: (client) => (
        <Link href={`/clients/${client.id}`} className="-my-3 flex min-h-12 items-center font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary">
          {client.name}
        </Link>
      ),
    },
    {
      key: 'contact', header: t('columns.contact'),
      plainValue: (client) => [client.primaryContact?.name, client.primaryContact?.role].filter(Boolean).join(' '),
      render: (client) => client.primaryContact ? (
        <div><p className="font-medium text-foreground">{client.primaryContact.name}</p>{client.primaryContact.role ? <p className="mt-0.5 text-xs text-muted-foreground">{client.primaryContact.role}</p> : null}</div>
      ) : <span className="text-muted-foreground">{t('noPrimaryContact')}</span>,
    },
    {
      key: 'projects', header: t('columns.activeProjects'), numeric: true,
      plainValue: (client) => client.activeProjectCount,
      render: (client) => <Link href={`/clients/${client.id}?tab=projects`} className="font-medium text-brand-primary hover:underline">{client.activeProjectCount}</Link>,
    },
    {
      key: 'balance', header: t('columns.outstandingBalance'), numeric: true,
      plainValue: (client) => client.outstandingBalance,
      render: (client) => client.outstandingBalance === null
        ? <span className="text-muted-foreground" title={t('balanceRestricted')}>{t('restricted')}</span>
        : <span className="font-medium tabular-nums text-foreground">{formatMoney(client.outstandingBalance, 'USD')}</span>,
    },
    { key: 'status', header: t('columns.status'), render: (client) => <ClientStatusBadge status={client.status} /> },
  ];
}

export function ClientsList() {
  const t = useTranslations('platform.clients');
  const { data = [], isPending, isError, refetch } = useClientSummaries();
  const [status, setStatus] = useState<ClientStatus | 'ALL'>('ALL');
  const filtered = status === 'ALL' ? data : data.filter((client) => client.status === status);
  const columns = useMemo(() => buildColumns(t), [t]);

  return (
    <PlatformDataGrid
      columns={columns} data={filtered} rowKey={(client) => client.id} label={t('title')}
      isLoading={isPending} isError={isError} onRetry={() => void refetch()}
      emptyState={<EmptyState title={t('empty')} description={t('emptyHint')} action={<Button asChild><Link href="/clients/new">{t('newClient')}</Link></Button>} />}
      toolbarLeft={(
        <div className="relative">
          <Label htmlFor="client-status" className="sr-only">{t('filterByStatus')}</Label>
          <Select id="client-status" value={status} className="ps-10" onChange={(event) => setStatus(event.target.value as ClientStatus | 'ALL')}>
            <option value="ALL">{t('allStatuses')}</option>
            {CLIENT_STATUS_ORDER.map((value) => <option key={value} value={value}>{t(`status.${value}`)}</option>)}
          </Select>
          <FunnelSimple size={18} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/65" aria-hidden="true" />
        </div>
      )}
    />
  );
}
