'use client';

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  cn,
  Combobox,
  DateRangePicker,
  EmptyState,
  FilterBar,
  FilterField,
  SkeletonTable,
  StatTile,
} from '@erp/ui';
import { Download, FileText, MessageCircle } from 'lucide-react';
import type { ClientStatement as ClientStatementData } from '@erp/types';

import { LoadError } from '@/components/load-error';
import { ListPageHeader } from '@/components/layout/list-page-header';
import { ReportActions } from '@/features/accounting/components/report-actions';
import { exportCsv, reportFilename } from '@/features/accounting/lib/export-csv';
import { useClients } from '@/features/clients/hooks/use-clients';
import { MessageHistory } from '@/features/communications/components/message-history';
import { StatementWhatsAppDialog } from '@/features/communications/components/statement-whatsapp-dialog';
import { apiClient } from '@/lib/api-client';
import { formatDate } from '@/lib/format';

import { AccountsTable, ActivityTable, OpenInvoicesTable, usd } from './statement-sections';

const TABS = ['accounts', 'open', 'activity'] as const;
type Tab = (typeof TABS)[number];

/** ST-6 — `GET /finance/clients/:clientId/statement/document`: the branded statement PDF. */
export function getClientStatementPdf(clientId: string, from: string, to: string): Promise<Blob> {
  return apiClient<Blob>(`/finance/clients/${clientId}/statement/document?from=${from}&to=${to}`, { responseType: 'blob' });
}

/** Saves the PDF under the name the client will see on WhatsApp. */
function savePdf(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** AR-3 — `GET /finance/clients/:clientId/statement?from&to`. */
export function getClientStatement(clientId: string, from: string, to: string): Promise<ClientStatementData> {
  return apiClient<ClientStatementData>(`/finance/clients/${clientId}/statement?from=${from}&to=${to}`);
}

function thisYear(now = new Date()) {
  const to = now.toISOString().slice(0, 10);
  return { from: `${to.slice(0, 4)}-01-01`, to };
}


/**
 * AR-3 / ST — a client's statement of account. Three views of one account: by project and
 * contract (value, billed, paid, owed, retention, left to bill), the invoices still owed (most
 * overdue first, aged), and every movement in the period with a running balance. Printing gives
 * all three under a letterhead; the CSV is the view on screen.
 */
export function ClientStatement() {
  const t = useTranslations('accounting.statement');
  const params = useSearchParams();
  const clients = useClients();
  const [clientId, setClientId] = useState(params?.get('clientId') ?? '');
  const [tab, setTab] = useState<Tab>('accounts');
  const [sending, setSending] = useState(false);
  const [range, setRange] = useState(() => {
    const fallback = thisYear();
    return { from: params?.get('from') ?? fallback.from, to: params?.get('to') ?? fallback.to };
  });
  const statement = useQuery({
    queryKey: ['finance', 'client-statement', clientId, range.from, range.to],
    queryFn: () => getClientStatement(clientId, range.from, range.to),
    enabled: Boolean(clientId),
  });
  const pdf = useMutation({
    mutationFn: async (data: ClientStatementData) => {
      const blob = await getClientStatementPdf(data.client.id, data.from, data.to);
      savePdf(blob, `Statement-${(data.client.code ?? data.client.name).replace(/[^A-Za-z0-9-]+/g, '-')}-${data.asOf}.pdf`);
    },
  });
  const clientOptions = useMemo(
    () => (clients.data ?? []).map((c) => ({ value: c.id, label: c.name, hint: c.code ?? undefined })),
    [clients.data],
  );

  const download = (data: ClientStatementData) => {
    const name = `statement-${data.client.code ?? data.client.name}`;
    if (tab === 'accounts') {
      exportCsv(
        reportFilename(`${name}-by-project`, data.asOf, data.asOf),
        [t('colAccount'), t('colContract'), t('colContractValue'), t('colBilled'), t('colLeftToBill'), t('colInvoiced'), t('colReceived'), t('colAdjusted'), t('colBalanceDue'), t('colOverdue'), t('colRetention')],
        data.accounts.map((r) => [
          r.kind === 'OTHER_SALES' ? t('otherSales') : r.projectName,
          r.contractNumber,
          r.contractValue === null ? null : Number(r.contractValue),
          r.billedToDate === null ? null : Number(r.billedToDate),
          r.leftToBill === null ? null : Number(r.leftToBill),
          Number(r.invoiced),
          Number(r.received),
          Number(r.credited) + Number(r.writtenOff),
          Number(r.balanceDue),
          Number(r.overdue),
          Number(r.retentionHeld),
        ]),
      );
      return;
    }
    if (tab === 'open') {
      exportCsv(
        reportFilename(`${name}-open-invoices`, data.asOf, data.asOf),
        [t('colInvoice'), t('colFor'), t('colDate'), t('colDue'), t('colTotal'), t('colReceived'), t('colAdjusted'), t('colBalance'), t('colDaysOverdue')],
        data.openInvoices.map((r) => [
          r.invoiceNumber,
          [r.projectName, r.contractNumber].filter(Boolean).join(' · ') || r.label,
          r.invoiceDate,
          r.dueDate,
          Number(r.total),
          Number(r.received),
          Number(r.adjusted),
          Number(r.balance),
          r.daysOverdue,
        ]),
      );
      return;
    }
    exportCsv(
      reportFilename(name, data.from, data.to),
      [t('colDate'), t('colDocument'), t('colKind'), t('colDetails'), t('colCharged'), t('colPaid'), t('colBalance')],
      [
        [data.from, null, t('opening'), null, null, null, Number(data.openingBalance)],
        ...data.lines.map((l) => [
          l.date,
          l.reference,
          t(`kinds.${l.kind}`),
          l.description,
          l.debit === null ? null : Number(l.debit),
          l.credit === null ? null : Number(l.credit),
          Number(l.balance),
        ]),
        [data.to, null, t('closing'), null, Number(data.totals.debits), Number(data.totals.credits), Number(data.closingBalance)],
      ],
    );
  };

  const data = statement.data;
  // What the client owes today (open invoices less cash on account) — the activity's closing
  // balance only when the period ends today.
  const balanceDue = data
    ? (data.openInvoices.reduce((s, i) => s + Math.round(Number(i.balance) * 100), 0) / 100 - Number(data.onAccount)).toFixed(2)
    : null;

  return (
    <div className="space-y-6">
      <ListPageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        summary={data ? t('summaryAsOf', { client: data.client.name, date: formatDate(data.asOf) ?? data.asOf }) : undefined}
        actions={
          data ? (
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              <Button type="button" size="sm" onClick={() => setSending(true)} className="gap-1.5">
                <MessageCircle size={16} aria-hidden="true" />
                {t('sendWhatsApp')}
              </Button>
              <Button type="button" variant="outline" size="sm" loading={pdf.isPending} onClick={() => pdf.mutate(data)} className="gap-1.5">
                <Download size={16} aria-hidden="true" />
                {t('pdf')}
              </Button>
              <ReportActions onExport={() => download(data)} />
            </div>
          ) : undefined
        }
      />

      <div className="print:hidden">
        <FilterBar>
          <FilterField id="statement-client" label={t('client')} grow>
            <Combobox
              id="statement-client"
              value={clientId}
              onChange={setClientId}
              options={clientOptions}
              placeholder={t('clientPlaceholder')}
              searchPlaceholder={t('clientSearch')}
              emptyLabel={t('clientEmpty')}
              loading={clients.isPending}
            />
          </FilterField>
          <FilterField id="statement-range" label={t('period')}>
            <DateRangePicker
              id="statement-range"
              fromValue={range.from}
              toValue={range.to}
              onChange={(next) => next.from && next.to && setRange({ from: next.from, to: next.to })}
            />
          </FilterField>
        </FilterBar>
      </div>

      {pdf.isError ? <Alert variant="error" messages={[t('pdfFailed')]} /> : null}

      {!clientId ? (
        <EmptyState icon={<FileText size={20} aria-hidden="true" />} title={t('pickTitle')} description={t('pickBody')} />
      ) : statement.isPending ? (
        <SkeletonTable columns={6} label={t('loading')} />
      ) : statement.isError || !data ? (
        <LoadError message={t('loadFailed')} onRetry={() => void statement.refetch()} />
      ) : (
        <>
          {/* Letterhead and addressee: the head of the printed statement, and who it is on screen. */}
          <section className="grid gap-6 rounded-panel border border-border bg-surface p-5 sm:grid-cols-2 sm:p-6">
            <div className="space-y-1 text-body-sm">
              <p className="text-caption font-medium uppercase tracking-wide text-muted-foreground">{t('statementFor')}</p>
              <p className="text-h3 font-semibold text-foreground">{data.client.name}</p>
              {data.client.code ? <p className="font-mono text-muted-foreground">{data.client.code}</p> : null}
              {data.client.address ? <p className="text-muted-foreground">{data.client.address}</p> : null}
              {data.client.taxNumber ? <p className="text-muted-foreground">{t('taxNumber', { number: data.client.taxNumber })}</p> : null}
            </div>
            <div className="space-y-1 text-body-sm sm:text-end">
              {data.organization ? (
                <>
                  <p className="font-semibold text-foreground">{data.organization.name}</p>
                  {data.organization.address ? <p className="text-muted-foreground">{data.organization.address}</p> : null}
                </>
              ) : null}
              <p className="text-muted-foreground">{t('asOf', { date: formatDate(data.asOf) ?? data.asOf })}</p>
            </div>
          </section>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label={t('balanceDue')} value={usd(balanceDue)} />
            <StatTile label={t('overdue')} value={usd(data.overdue)} />
            <StatTile label={t('retentionHeld')} value={usd(data.retentionHeld)} />
            <StatTile label={t('onAccountTile')} value={usd(data.onAccount)} />
          </div>

          <div role="tablist" aria-label={t('viewsLabel')} className="inline-flex rounded-control border border-border bg-surface p-0.5 print:hidden">
            {TABS.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                id={`statement-tab-${key}`}
                aria-selected={tab === key}
                aria-controls={`statement-panel-${key}`}
                onClick={() => setTab(key)}
                className={cn(
                  'h-9 rounded-[calc(var(--radius-control)-2px)] px-3 text-body-sm font-medium focus-visible:outline-2 focus-visible:outline-brand-primary',
                  tab === key ? 'bg-brand-accent text-brand-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t(`tabs.${key}`)}
                {key === 'open' && data.openInvoices.length > 0 ? (
                  <span className="ms-1.5 text-caption text-muted-foreground">{data.openInvoices.length}</span>
                ) : null}
              </button>
            ))}
          </div>

          {/* On screen one view at a time; on paper all three, each under its heading. */}
          {TABS.map((key) => (
            <section
              key={key}
              id={`statement-panel-${key}`}
              role="tabpanel"
              aria-labelledby={`statement-tab-${key}`}
              className={cn('space-y-3', tab === key ? 'block' : 'hidden print:block')}
            >
              <h2 className="hidden text-body font-semibold print:block">{t(`tabs.${key}`)}</h2>
              {key === 'accounts' ? <AccountsTable data={data} /> : key === 'open' ? <OpenInvoicesTable data={data} /> : <ActivityTable data={data} />}
            </section>
          ))}

          <div className="print:hidden">
            <MessageHistory resourceType="client_statement" resourceId={data.client.id} canResolve hideWhenEmpty />
          </div>

          <StatementWhatsAppDialog
            open={sending}
            onClose={() => setSending(false)}
            clientId={data.client.id}
            from={data.from}
            to={data.to}
            title={t('whatsappTitle')}
            subtitle={t('whatsappSubtitle', { client: data.client.name, date: formatDate(data.asOf) ?? data.asOf })}
          />
        </>
      )}
    </div>
  );
}
