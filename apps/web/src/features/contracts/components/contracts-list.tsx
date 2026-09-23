'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ContractStatus } from '@erp/types';
import { FilterBar, FilterField, Input, Select } from '@erp/ui';

import { PlatformDataGrid, type GridColumn } from '@/components/platform-data-grid';
import { formatDate, formatMoney } from '@/lib/format';

import { filterContracts } from '../filter-contracts';
import { useContracts } from '../hooks/use-contracts';
import { CONTRACT_STATUS_ORDER, type Contract } from '../types';
import { ContractStatusBadge } from './contract-status-badge';

interface ContractsListProps {
  /** Scopes the query server-side — the one filter `GET /contracts` offers. */
  projectId?: string;
}

export function ContractsList({ projectId }: ContractsListProps = {}) {
  const t = useTranslations('platform.contracts');
  const { data, isPending, isError, refetch } = useContracts(projectId);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ContractStatus | 'ALL'>('ALL');

  const visible = useMemo(
    () => filterContracts(data ?? [], { search, status }),
    [data, search, status],
  );

  const unset = <span className="text-muted-foreground">{t('notSet')}</span>;

  const columns: GridColumn<Contract>[] = [
    {
      key: 'number',
      header: t('columns.number'),
      sticky: true,
      sortable: true,
      plainValue: (contract) => contract.contractNumber,
      render: (contract) => (
        <span className="font-mono text-caption font-semibold">{contract.contractNumber}</span>
      ),
    },
    {
      key: 'value',
      header: t('columns.value'),
      numeric: true,
      sortable: true,
      plainValue: (contract) => Number(contract.contractValue),
      render: (contract, ctx) =>
        formatMoney(contract.contractValue, contract.currency, ctx.locale) ?? unset,
    },
    {
      key: 'billing',
      header: t('columns.billing'),
      sortable: true,
      plainValue: (contract) => contract.billingModel,
      render: (contract) => t(`billingModel.${contract.billingModel}`),
    },
    {
      key: 'dates',
      header: t('columns.dates'),
      sortable: true,
      plainValue: (contract) => contract.startDate ?? '',
      render: (contract, ctx) => formatDate(contract.startDate, ctx.locale) ?? unset,
    },
    {
      key: 'status',
      header: t('columns.status'),
      render: (contract) => <ContractStatusBadge status={contract.status} />,
    },
  ];

  return (
    <div className="space-y-5">
      <PlatformDataGrid
        columns={columns}
        data={visible}
        rowKey={(contract) => contract.id}
        label={t('title')}
        isLoading={isPending}
        isError={isError}
        errorMessage={t('loadFailed')}
        onRetry={() => void refetch()}
        rowHref={(contract) => `/projects/${contract.projectId}/commercial/contract-security`}
        emptyState={
          (data?.length ?? 0) === 0 ? (
            <div className="rounded-panel border border-dashed border-border bg-surface px-6 py-12 text-center">
              <p className="text-sm font-medium text-foreground">{t('empty')}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t('emptyHint')}</p>
            </div>
          ) : undefined
        }
        noMatchMessage={t('noMatches')}
        resultLabel={(count) => t('countLabel', { count })}
        pagination={{ defaultPageSize: 25 }}
        toolbarFilters={
          <FilterBar>
            <FilterField id="contract-search" label={t('searchLabel')} hideLabel grow>
              <Input
                id="contract-search"
                type="search"
                placeholder={t('searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </FilterField>

            <FilterField id="contract-status" label={t('filterByStatus')} hideLabel>
              <Select
                id="contract-status"
                value={status}
                onChange={(value) => setStatus(value as ContractStatus | 'ALL')}
              >
                <option value="ALL">{t('allStatuses')}</option>
                {CONTRACT_STATUS_ORDER.map((value) => (
                  <option key={value} value={value}>
                    {t(`status.${value}`)}
                  </option>
                ))}
              </Select>
            </FilterField>
          </FilterBar>
        }
        onClearFilters={() => {
          setSearch('');
          setStatus('ALL');
        }}
      />
    </div>
  );
}
