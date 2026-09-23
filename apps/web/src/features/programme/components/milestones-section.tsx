'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { MilestoneReleaseLine, ProgrammeMilestoneResponse } from '@erp/types';
import {
  Alert,
  DatePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  FormField,
  Input,
} from '@erp/ui';
import { Flag } from 'lucide-react';

import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';
import { useDialogDismissGuard } from '@/lib/use-dialog-dismiss-guard';

import { useCreateMilestone, useMilestones, useVerifyMilestone } from '../hooks/use-programme';
import {
  RefButton,
  RefCard,
  RefCardBody,
  RefCardHeader,
  RefEmpty,
  RefPill,
  RefTable,
  RefTableScroll,
  RefTbody,
  RefTd,
  RefTh,
  RefThead,
  RefTr,
  type RefTone,
} from '@/features/progress/components/ref-ui';

const STATUS_TONE: Record<ProgrammeMilestoneResponse['status'], RefTone> = {
  PLANNED: 'gray',
  VERIFIED: 'green',
};

const refFieldClass = 'rounded-lg border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500';

/** Whole-day difference actual − baseline; negative = early. Null when not both present. */
function varianceDays(baseline: string, actual: string | null): number | null {
  if (!actual) return null;
  const ms = new Date(actual).getTime() - new Date(baseline).getTime();
  return Math.round(ms / 86_400_000);
}

/**
 * `percentage` is a 0..1 fraction string ("0.4000"). Format it as a percent the same way the
 * commercial payment schedule does, so a milestone's "Releases 40%" matches the installment row
 * it points at. Falls back to the raw string if it is not a finite number.
 */
function formatFraction(fraction: string, locale: 'en' | 'ar'): string {
  const n = Number(fraction);
  if (!Number.isFinite(n)) return fraction;
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-u-nu-latn' : locale, {
    style: 'percent',
    maximumFractionDigits: 2,
  }).format(n);
}

/** Money for a release line, using the line's own currency (the contract's). */
function releaseAmount(release: MilestoneReleaseLine, locale: 'en' | 'ar'): string {
  return formatMoney(release.amount, release.currency, locale) ?? release.amount;
}

export function MilestonesSection({ projectId }: { projectId: string }) {
  const t = useTranslations('progress');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const { data, isPending, isError, refetch, isFetching } = useMilestones(projectId);
  const [verifying, setVerifying] = useState<ProgrammeMilestoneResponse | null>(null);

  function variance(m: ProgrammeMilestoneResponse): string {
    const d = varianceDays(m.baselineDate, m.actualDate);
    if (d === null) return '—';
    if (d === 0) return t('programme.variance.onTime');
    return d < 0 ? t('programme.variance.early', { n: -d }) : t('programme.variance.late', { n: d });
  }

  return (
    <RefCard>
      <RefCardHeader
        icon={<Flag size={17} strokeWidth={1.9} />}
        iconTone="violet"
        title={t('tabs.milestones')}
        subtitle={t('programme.subtitle')}
        divider
      />
      <RefCardBody className="space-y-4 pt-4">
        <CreateMilestoneForm projectId={projectId} />

        {isPending ? (
          <div role="status" aria-live="polite">
            <span className="sr-only">{tCommon('loading')}</span>
            <div className="h-40 animate-pulse rounded-xl bg-gray-100" aria-hidden="true" />
          </div>
        ) : isError ? (
          <Alert variant="error" messages={[t('programme.states.loadFailed')]}>
            <div className="mt-3">
              <RefButton variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
                {t('programme.actions.retry')}
              </RefButton>
            </div>
          </Alert>
        ) : data.length === 0 ? (
          <RefEmpty title={t('programme.states.emptyTitle')} hint={t('programme.states.emptyHint')} />
        ) : (
          <RefTableScroll aria-label={t('programme.title')}>
            <RefTable>
              <RefThead>
                <RefTr>
                  <RefTh>{t('programme.col.code')}</RefTh>
                  <RefTh>{t('programme.col.name')}</RefTh>
                  <RefTh>{t('programme.col.baseline')}</RefTh>
                  <RefTh>{t('programme.col.actual')}</RefTh>
                  <RefTh>{t('programme.col.variance')}</RefTh>
                  <RefTh>{t('programme.col.releases')}</RefTh>
                  <RefTh>{t('programme.col.status')}</RefTh>
                  <RefTh>
                    <span className="sr-only">{t('programme.col.actions')}</span>
                  </RefTh>
                </RefTr>
              </RefThead>
              <RefTbody>
                {data.map((m) => (
                  <RefTr key={m.id}>
                    <RefTd className="whitespace-nowrap font-mono text-xs">{m.code}</RefTd>
                    <RefTd className="font-medium">{m.name}</RefTd>
                    <RefTd className="whitespace-nowrap text-gray-500">
                      {formatDate(m.baselineDate, locale)}
                    </RefTd>
                    <RefTd className="whitespace-nowrap text-gray-500">
                      {m.actualDate ? formatDate(m.actualDate, locale) : '—'}
                    </RefTd>
                    <RefTd className="whitespace-nowrap text-gray-500">{variance(m)}</RefTd>
                    <RefTd>
                      <ReleasesCell releases={m.releases} locale={locale} t={t} />
                    </RefTd>
                    <RefTd>
                      <RefPill tone={STATUS_TONE[m.status]}>{t(`programme.status.${m.status}`)}</RefPill>
                    </RefTd>
                    <RefTd className="text-end">
                      {m.status === 'PLANNED' ? (
                        <RefButton variant="ghost" size="sm" onClick={() => setVerifying(m)}>
                          {t('programme.actions.verify')}
                        </RefButton>
                      ) : null}
                    </RefTd>
                  </RefTr>
                ))}
              </RefTbody>
            </RefTable>
          </RefTableScroll>
        )}
      </RefCardBody>

      {verifying ? (
        <VerifyMilestoneDialog
          projectId={projectId}
          milestone={verifying}
          onDismiss={() => setVerifying(null)}
        />
      ) : null}
    </RefCard>
  );
}

/**
 * What a milestone RELEASES for invoicing (Master Schedule P2). Each line is the payment
 * installment this milestone gates: "Releases 40% · Structure · $300,000", with a subtle
 * "invoiced" tag once a client invoice has already been raised from it. Stacked chips keep it
 * legible at 375px; an unlinked milestone (`releases: []`) shows a muted em dash.
 */
function ReleasesCell({
  releases,
  locale,
  t,
}: {
  releases: MilestoneReleaseLine[];
  locale: 'en' | 'ar';
  t: ReturnType<typeof useTranslations>;
}) {
  if (releases.length === 0) {
    return <span className="text-gray-400">{t('programme.releases.none')}</span>;
  }

  return (
    <ul className="flex flex-col gap-1">
      {releases.map((r) => (
        <li key={r.installmentId} className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm text-gray-700">
            {t('programme.releases.line', {
              percent: formatFraction(r.percentage, locale),
              name: r.name,
              amount: releaseAmount(r, locale),
            })}
          </span>
          {r.invoiced ? (
            <RefPill tone="green" aria-label={t('programme.releases.invoicedLabel')}>
              {t('programme.releases.invoiced')}
            </RefPill>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function CreateMilestoneForm({ projectId }: { projectId: string }) {
  const t = useTranslations('progress');
  const create = useCreateMilestone(projectId);

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [baselineDate, setBaselineDate] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const codeError = touched && !code.trim() ? t('programme.form.codeRequired') : undefined;
  const nameError = touched && !name.trim() ? t('programme.form.nameRequired') : undefined;
  const dateError = touched && !baselineDate ? t('programme.form.baselineRequired') : undefined;

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setTouched(true);
    setError(null);
    if (!code.trim() || !name.trim() || !baselineDate) return;
    create.mutate(
      { code: code.trim(), name: name.trim(), baselineDate },
      {
        onSuccess: () => {
          setCode('');
          setName('');
          setBaselineDate('');
          setTouched(false);
        },
        onError: (e) => setError(e instanceof ApiError ? e.message : t('programme.states.loadFailed')),
      },
    );
  }

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-gray-100 bg-gray-50 p-4 sm:p-5" aria-label={t('programme.new')}>
      <h3 className="text-sm font-semibold text-gray-900">{t('programme.new')}</h3>
      {error ? (
        <div className="mt-3">
          <Alert variant="error" messages={[error]} />
        </div>
      ) : null}
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <FormField htmlFor="ms-code" label={t('programme.form.code')} error={codeError}>
          <Input id="ms-code" value={code} placeholder={t('programme.form.codePlaceholder')} onChange={(e) => setCode(e.target.value)} className={refFieldClass} />
        </FormField>
        <FormField htmlFor="ms-name" label={t('programme.form.name')} error={nameError}>
          <Input id="ms-name" value={name} placeholder={t('programme.form.namePlaceholder')} onChange={(e) => setName(e.target.value)} className={refFieldClass} />
        </FormField>
        <FormField htmlFor="ms-baseline" label={t('programme.form.baselineDate')} error={dateError}>
          <DatePicker id="ms-baseline" value={baselineDate} onChange={(value) => setBaselineDate(value)} className={refFieldClass} />
        </FormField>
      </div>
      <div className="mt-3">
        <RefButton type="submit" disabled={create.isPending}>
          {t('programme.form.submit')}
        </RefButton>
      </div>
    </form>
  );
}

function VerifyMilestoneDialog({
  projectId,
  milestone,
  onDismiss,
}: {
  projectId: string;
  milestone: ProgrammeMilestoneResponse;
  onDismiss: () => void;
}) {
  const t = useTranslations('progress');
  const locale = useLocale() as 'en' | 'ar';
  const verify = useVerifyMilestone(projectId);
  const [actualDate, setActualDate] = useState(new Date().toISOString().slice(0, 10));

  const dismissGuard = useDialogDismissGuard(verify.isPending, onDismiss);

  // Name the consequence: when this milestone gates payment installments, say which ones verifying
  // will release for invoicing. Falls back to the generic hint when nothing is linked.
  const releases = milestone.releases;
  let verifyNote: string;
  if (releases.length === 0) {
    verifyNote = t('programme.verify.hint');
  } else if (releases.length === 1) {
    const r = releases[0]!;
    verifyNote = t('programme.verify.hintReleaseOne', {
      percent: formatFraction(r.percentage, locale),
      name: r.name,
      amount: releaseAmount(r, locale),
    });
  } else {
    verifyNote = t('programme.verify.hintReleaseMany', {
      count: releases.length,
      list: releases
        .map((r) => `${formatFraction(r.percentage, locale)} ${r.name} (${releaseAmount(r, locale)})`)
        .join(', '),
    });
  }

  return (
    <Dialog open onOpenChange={dismissGuard.onOpenChange}>
      <DialogContent {...dismissGuard.contentProps}>
        <DialogTitle>{t('programme.verify.title', { name: milestone.name })}</DialogTitle>
        <DialogDescription>{verifyNote}</DialogDescription>

        {verify.isError ? (
          <div className="mt-4">
            <Alert
              variant="error"
              messages={[verify.error instanceof ApiError ? verify.error.message : t('programme.states.loadFailed')]}
            />
          </div>
        ) : null}

        <div className="mt-4">
          <FormField htmlFor="ms-actual" label={t('programme.verify.actualDate')}>
            <DatePicker id="ms-actual" value={actualDate} onChange={(value) => setActualDate(value)} className={refFieldClass} />
          </FormField>
        </div>

        <DialogFooter>
          <RefButton
            onClick={() =>
              verify.mutate({ milestoneId: milestone.id, actualDate }, { onSuccess: onDismiss })
            }
            disabled={verify.isPending || !actualDate}
          >
            {t('programme.actions.verify')}
          </RefButton>
          <RefButton variant="outline" onClick={onDismiss} disabled={verify.isPending}>
            {t('programme.actions.cancel')}
          </RefButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
