'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ClipboardList, CloudUpload, FileText, PackageCheck, Receipt, Undo2 } from 'lucide-react';
import { Button, cn } from '@erp/ui';
import { PERMISSIONS, type SentBackItem } from '@erp/types';

import { usePermissions } from '@/features/auth/permissions/can';
import { useOutbox, useOutboxItems } from '@/features/outbox/instance';
import { useQueueItems } from '@/features/procurement/hooks/use-quote-uploads';
import { apiClient } from '@/lib/api-client';
import { formatDate } from '@/lib/format';

const SENDING = new Set(['queued', 'uploading', 'binding', 'retrying', 'offline']);

const getSentBack = () => apiClient<SentBackItem[]>('/procurement/sent-back');

/**
 * Step 7 — the site-staff Home, the installed app's start page (designed for the phone first).
 * What was sent back leads ("Photo is blurry — retake"), then four big buttons for what a site
 * person sends: a supplier quote, a receipt, a delivery note, a material request. Each button is
 * shown only to someone who may send it. Photos still waiting for signal are counted at the top.
 */
export function SiteHome() {
  const t = useTranslations('procurement.site');
  const { can } = usePermissions();
  const collects = can(PERMISSIONS.quotationsCollect) && can(PERMISSIONS.procurementView);
  const sentBack = useQuery({ queryKey: ['procurement', 'sent-back'], queryFn: getSentBack, enabled: collects });
  // Sent from this phone but not yet through: queued, uploading, or held for signal.
  const waiting = useQueueItems().filter((i) => SENDING.has(i.phase)).length;
  // Forms kept on the phone (no signal when sent), and any the server refused since.
  const outbox = useOutbox();
  const forms = useOutboxItems();

  const actions = [
    { key: 'quote', href: '/procurement/quotes', Icon: FileText, allowed: collects },
    { key: 'receipt', href: '/procurement/quotes', Icon: Receipt, allowed: collects },
    { key: 'delivery', href: '/procurement/grn/new', Icon: PackageCheck, allowed: can(PERMISSIONS.goodsReceiptsCreate) },
    { key: 'request', href: '/procurement/requests/new', Icon: ClipboardList, allowed: can(PERMISSIONS.materialRequestsCreate) },
  ].filter((a) => a.allowed);

  return (
    <div className="mx-auto w-full max-w-md space-y-6 pb-10">
      <h1 className="text-h1 font-bold text-foreground">{t('title')}</h1>

      {waiting > 0 ? (
        <p className="flex items-center gap-2 rounded-panel border border-border bg-surface-subtle px-4 py-3 text-body-sm text-foreground" role="status">
          <CloudUpload size={18} className="shrink-0 text-brand-primary" aria-hidden="true" />
          {t('waiting', { count: waiting })}
        </p>
      ) : null}

      {forms.length > 0 ? (
        <section aria-labelledby="site-outbox" className="space-y-2">
          <h2 id="site-outbox" className="text-body font-semibold text-foreground">{t('outboxTitle', { count: forms.length })}</h2>
          <ul className="space-y-2">
            {forms.map((f) => (
              <li key={f.clientRef} className={cn('rounded-panel border px-4 py-3', f.status === 'failed' ? 'border-danger/40 bg-danger-subtle' : 'border-border bg-surface')}>
                <p className="font-medium text-foreground">{f.label}</p>
                <p className="text-body-sm text-muted-foreground">
                  {f.status === 'failed' ? t('outboxFailed', { error: f.error ?? '' }) : f.status === 'sending' ? t('outboxSending') : t('outboxWaiting')}
                </p>
                {f.status === 'failed' ? (
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => void outbox?.retry(f.clientRef)}>{t('outboxRetry')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => void outbox?.discard(f.clientRef)}>{t('outboxDiscard')}</Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {sentBack.data && sentBack.data.length > 0 ? (
        <section aria-labelledby="site-sent-back" className="space-y-2">
          <h2 id="site-sent-back" className="text-body font-semibold text-foreground">{t('sentBackTitle', { count: sentBack.data.length })}</h2>
          <ul className="space-y-2">
            {sentBack.data.map((item) => (
              <li key={`${item.kind}-${item.id}`}>
                <Link
                  href={`/procurement/quotes/${item.quotationRequestId}`}
                  className="flex min-h-16 items-start gap-3 rounded-panel border border-warning/40 bg-warning-subtle px-4 py-3 hover:border-warning"
                >
                  <Undo2 size={18} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-foreground">{t(`sentBack.${item.kind}`, { number: item.number, store: item.storeName ?? '' })}</span>
                    <span className="block text-body-sm text-foreground">
                      {item.reason ? t(`reason.${item.reason}`) : null}
                      {item.reason && item.note ? ' — ' : null}
                      {item.note}
                    </span>
                    <span className="block text-caption text-muted-foreground">{formatDate(item.at.slice(0, 10)) ?? item.at.slice(0, 10)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {actions.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">{t('nothingToSend')}</p>
      ) : (
        <nav aria-label={t('actionsLabel')} className="grid grid-cols-2 gap-3">
          {actions.map(({ key, href, Icon }) => (
            <Link
              key={key}
              href={href}
              className={cn(
                'flex aspect-square flex-col items-center justify-center gap-2 rounded-container border border-border bg-surface p-4 text-center shadow-e1',
                'hover:border-brand-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary',
              )}
            >
              <Icon size={32} className="text-brand-primary" aria-hidden="true" />
              <span className="text-body font-semibold text-foreground">{t(`actions.${key}`)}</span>
              <span className="text-caption text-muted-foreground">{t(`actionHints.${key}`)}</span>
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
