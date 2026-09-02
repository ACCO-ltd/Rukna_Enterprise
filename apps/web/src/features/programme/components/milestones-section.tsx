'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { ProgrammeMilestoneResponse } from '@erp/types';
import {
  Alert,
  Badge,
  Button,
  DatePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  FormField,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  type BadgeTone,
} from '@erp/ui';

import { ApiError } from '@/lib/api-client';
import { formatDate } from '@/lib/format';
import { useDialogDismissGuard } from '@/lib/use-dialog-dismiss-guard';

import { useCreateMilestone, useMilestones, useVerifyMilestone } from '../hooks/use-programme';

const STATUS_TONE: Record<ProgrammeMilestoneResponse['status'], BadgeTone> = {
  PLANNED: 'neutral',
  VERIFIED: 'live',
};

/** Whole-day difference actual − baseline; negative = early. Null when not both present. */
function varianceDays(baseline: string, actual: string | null): number | null {
  if (!actual) return null;
  const ms = new Date(actual).getTime() - new Date(baseline).getTime();
  return Math.round(ms / 86_400_000);
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
    <div className="space-y-4">
      <p className="text-body-sm text-muted-foreground">{t('programme.subtitle')}</p>

      <CreateMilestoneForm projectId={projectId} />

      {isPending ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">{tCommon('loading')}</span>
          <div className="h-40 animate-pulse rounded-panel border border-border bg-muted" aria-hidden="true" />
        </div>
      ) : isError ? (
        <Alert variant="error" messages={[t('programme.states.loadFailed')]}>
          <div className="mt-3">
            <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
              {t('programme.actions.retry')}
            </Button>
          </div>
        </Alert>
      ) : data.length === 0 ? (
        <div className="rounded-panel border border-dashed border-border bg-surface px-6 py-12 text-center">
          <p className="text-sm font-medium text-foreground">{t('programme.states.emptyTitle')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('programme.states.emptyHint')}</p>
        </div>
      ) : (
        <TableScroll aria-label={t('programme.title')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('programme.col.code')}</TableHead>
                <TableHead>{t('programme.col.name')}</TableHead>
                <TableHead>{t('programme.col.baseline')}</TableHead>
                <TableHead>{t('programme.col.actual')}</TableHead>
                <TableHead>{t('programme.col.variance')}</TableHead>
                <TableHead>{t('programme.col.status')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('programme.col.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="whitespace-nowrap font-mono text-xs">{m.code}</TableCell>
                  <TableCell className="font-medium text-foreground">{m.name}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDate(m.baselineDate, locale)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {m.actualDate ? formatDate(m.actualDate, locale) : '—'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{variance(m)}</TableCell>
                  <TableCell>
                    <Badge tone={STATUS_TONE[m.status]}>{t(`programme.status.${m.status}`)}</Badge>
                  </TableCell>
                  <TableCell className="text-end">
                    {m.status === 'PLANNED' ? (
                      <Button variant="ghost" size="sm" onClick={() => setVerifying(m)}>
                        {t('programme.actions.verify')}
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScroll>
      )}

      {verifying ? (
        <VerifyMilestoneDialog
          projectId={projectId}
          milestone={verifying}
          onDismiss={() => setVerifying(null)}
        />
      ) : null}
    </div>
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
    <form onSubmit={onSubmit} className="rounded-panel border border-border bg-surface p-4 sm:p-5" aria-label={t('programme.new')}>
      <h3 className="text-sm font-semibold text-foreground">{t('programme.new')}</h3>
      {error ? (
        <div className="mt-3">
          <Alert variant="error" messages={[error]} />
        </div>
      ) : null}
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <FormField htmlFor="ms-code" label={t('programme.form.code')} error={codeError}>
          <Input id="ms-code" value={code} placeholder={t('programme.form.codePlaceholder')} onChange={(e) => setCode(e.target.value)} />
        </FormField>
        <FormField htmlFor="ms-name" label={t('programme.form.name')} error={nameError}>
          <Input id="ms-name" value={name} placeholder={t('programme.form.namePlaceholder')} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField htmlFor="ms-baseline" label={t('programme.form.baselineDate')} error={dateError}>
          <DatePicker id="ms-baseline" value={baselineDate} onChange={(value) => setBaselineDate(value)} />
        </FormField>
      </div>
      <div className="mt-3">
        <Button type="submit" disabled={create.isPending}>
          {t('programme.form.submit')}
        </Button>
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
  const verify = useVerifyMilestone(projectId);
  const [actualDate, setActualDate] = useState(new Date().toISOString().slice(0, 10));

  const dismissGuard = useDialogDismissGuard(verify.isPending, onDismiss);

  return (
    <Dialog open onOpenChange={dismissGuard.onOpenChange}>
      <DialogContent {...dismissGuard.contentProps}>
        <DialogTitle>{t('programme.verify.title', { name: milestone.name })}</DialogTitle>
        <DialogDescription>{t('programme.verify.hint')}</DialogDescription>

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
            <DatePicker id="ms-actual" value={actualDate} onChange={(value) => setActualDate(value)} />
          </FormField>
        </div>

        <DialogFooter>
          <Button
            onClick={() =>
              verify.mutate({ milestoneId: milestone.id, actualDate }, { onSuccess: onDismiss })
            }
            disabled={verify.isPending || !actualDate}
          >
            {t('programme.actions.verify')}
          </Button>
          <Button variant="outline" onClick={onDismiss} disabled={verify.isPending}>
            {t('programme.actions.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
