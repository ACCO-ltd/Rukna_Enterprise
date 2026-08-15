'use client';

import Link from 'next/link';
import { Check, Circle, FileCheck2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, Button, Skeleton, cn } from '@erp/ui';
import type { CommercialCycleStage } from '@erp/types';

import { useCommercialCurrentCycle } from '../hooks/use-commercial';

const STAGES = [
  'contract',
  'prepare',
  'submitted',
  'certification',
  'certified',
  'invoice',
  'payment',
  'settled',
] as const;

export function CurrentPaymentCycle({ projectId }: { projectId: string }) {
  const t = useTranslations('commercial.cycle');
  const query = useCommercialCurrentCycle(projectId);

  if (query.isPending) return <Skeleton className="h-44 w-full" />;
  if (query.isError)
    return (
      <Alert variant="error" title={t('loadFailed')} messages={[t('loadFailedHint')]}>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => query.refetch()}>
          {t('retry')}
        </Button>
      </Alert>
    );

  const cycle = query.data;
  const current = stageIndex(cycle.stage);

  return (
    <section className="overflow-hidden rounded-panel border border-border bg-surface shadow-e1">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <h2 className="text-body-sm font-semibold text-foreground">{t('title')}</h2>
          <p className="mt-0.5 text-caption text-muted-foreground">
            {cycle.application?.applicationRef ?? t(`stageSummary.${cycle.stage}`)}
          </p>
        </div>
        {cycle.nextAction ? (
          <Button asChild size="sm" className="min-h-11">
            <Link href={cycle.nextAction.href}>{t(`actions.${cycle.nextAction.kind}`)}</Link>
          </Button>
        ) : null}
      </div>
      <div className="overflow-x-auto px-4 py-4 sm:px-5">
        <ol className="grid min-w-[760px] grid-cols-8" aria-label={t('label')}>
          {STAGES.map((stage, index) => {
            const complete = index < current;
            const active = index === current;
            return (
              <li
                key={stage}
                className="relative flex flex-col items-center text-center"
                aria-current={active ? 'step' : undefined}
              >
                {index > 0 ? (
                  <span
                    className={cn(
                      'absolute end-1/2 top-3 h-px w-full',
                      index <= current ? 'bg-success' : 'bg-border-strong',
                    )}
                    aria-hidden="true"
                  />
                ) : null}
                <span
                  className={cn(
                    'relative z-10 flex size-6 items-center justify-center rounded-full border bg-surface',
                    complete && 'border-success bg-success text-on-success',
                    active &&
                      'border-brand-primary bg-brand-primary-subtle text-brand-primary ring-4 ring-brand-primary/10',
                    !complete && !active && 'border-border-strong text-muted-foreground',
                  )}
                >
                  {complete ? (
                    <Check size={13} aria-hidden="true" />
                  ) : active ? (
                    <FileCheck2 size={13} aria-hidden="true" />
                  ) : (
                    <Circle size={8} aria-hidden="true" />
                  )}
                </span>
                <span
                  className={cn(
                    'mt-2 max-w-24 text-micro font-medium',
                    active ? 'text-brand-primary' : 'text-muted-foreground',
                  )}
                >
                  {t(`stages.${stage}`)}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

export function stageIndex(stage: CommercialCycleStage): number {
  if (stage === 'NO_CONTRACT' || stage === 'CONTRACT_DRAFT') return 0;
  if (
    stage === 'READY_FOR_APPLICATION' ||
    stage === 'APPLICATION_DRAFT' ||
    stage === 'APPLICATION_RETURNED'
  )
    return 1;
  if (stage === 'APPLICATION_SUBMITTED') return 2;
  if (stage === 'AWAITING_CERTIFICATION') return 3;
  if (stage === 'CERTIFIED' || stage === 'AWAITING_INVOICE') return 4;
  if (stage === 'INVOICE_DRAFT') return 5;
  if (stage === 'AWAITING_PAYMENT' || stage === 'PARTIALLY_PAID') return 6;
  return 7;
}
