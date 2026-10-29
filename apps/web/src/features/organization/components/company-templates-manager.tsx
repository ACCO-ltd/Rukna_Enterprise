'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, Badge, Button, Checkbox, ConfirmDialog, Input, Panel, cn } from '@erp/ui';
import type {
  CompanyTemplatesResponse,
  PaymentPlanTemplateRow,
  ScheduleTemplatePhaseDto,
} from '@erp/types';

import { usePermissions } from '@/features/auth/permissions/can';
import { ApiError } from '@/lib/api-client';

import {
  useCompanyTemplates,
  useResetCompanyTemplate,
  useSavePaymentPlanTemplate,
  useSaveScheduleTemplate,
} from '../hooks/use-company-templates';

/**
 * Administration → Templates (Step 1b, ADR-047). Rukna ships a default payment plan and building
 * schedule; a company edits its own copy here and can reset to the default at any time. The
 * contract builders and the schedule wizard start from whatever is in force.
 *
 * The server owns the rules (domain/template-rules.ts) and returns every problem at once; the
 * running total here is only so the user sees 100% before pressing Save.
 */
export function CompanyTemplatesManager() {
  const t = useTranslations('platform.templates');
  const tCommon = useTranslations('common');
  const { can } = usePermissions();
  const { data, isPending, isError, refetch } = useCompanyTemplates();

  if (isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
        <div className="h-64 animate-pulse rounded-panel border border-border bg-muted" aria-hidden="true" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <Alert variant="error" messages={[t('loadFailed')]}>
        <div className="mt-3">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            {t('retry')}
          </Button>
        </div>
      </Alert>
    );
  }

  const canManage = can('manage:organization');
  // Keyed by the stored value so a save or reset re-seeds the editor from the server's copy.
  return (
    <div className="flex flex-col gap-6">
      <PaymentPlanEditor
        key={JSON.stringify(data.paymentPlan)}
        template={data.paymentPlan}
        canManage={canManage}
      />
      <ScheduleEditor key={JSON.stringify(data.schedule)} template={data.schedule} canManage={canManage} />
    </div>
  );
}

function problemsOf(error: unknown): string[] {
  if (!(error instanceof ApiError)) return [];
  const problems = error.details?.['problems'];
  if (Array.isArray(problems)) return problems.map(String);
  return error.messages.length > 0 ? error.messages : [error.message];
}

function SourceBadge({ isDefault }: { isDefault: boolean }) {
  const t = useTranslations('platform.templates');
  return <Badge tone={isDefault ? 'neutral' : 'progress'}>{isDefault ? t('ruknaDefault') : t('companyCopy')}</Badge>;
}

function RowMoveButtons({
  index,
  count,
  onMove,
  disabled,
  label,
}: {
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
  disabled: boolean;
  label: string;
}) {
  const t = useTranslations('platform.templates');
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={disabled || index === 0}
        onClick={() => onMove(index, index - 1)}
        aria-label={t('moveUp', { name: label })}
      >
        <ArrowUp size={16} aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={disabled || index === count - 1}
        onClick={() => onMove(index, index + 1)}
        aria-label={t('moveDown', { name: label })}
      >
        <ArrowDown size={16} aria-hidden="true" />
      </Button>
    </>
  );
}

function move<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

function EditorFooter({
  dirty,
  isDefault,
  canManage,
  saving,
  resetting,
  onSave,
  onDiscard,
  onReset,
  summary,
}: {
  dirty: boolean;
  isDefault: boolean;
  canManage: boolean;
  saving: boolean;
  resetting: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onReset: () => void;
  summary: React.ReactNode;
}) {
  const t = useTranslations('platform.templates');
  const [confirmReset, setConfirmReset] = useState(false);
  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
      <div aria-live="polite">{summary}</div>
      {canManage ? (
        <div className="flex flex-wrap gap-2">
          {!isDefault ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmReset(true)} disabled={saving}>
              {t('reset')}
            </Button>
          ) : null}
          {dirty ? (
            <Button type="button" variant="outline" size="sm" onClick={onDiscard} disabled={saving}>
              {t('discard')}
            </Button>
          ) : null}
          <Button type="button" size="sm" onClick={onSave} disabled={!dirty || saving}>
            {saving ? t('saving') : t('save')}
          </Button>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title={t('resetTitle')}
        description={t('resetBody')}
        confirmLabel={t('resetConfirm')}
        isPending={resetting}
        onConfirm={() => {
          onReset();
          setConfirmReset(false);
        }}
      />
    </div>
  );
}

// ─── Payment plan ────────────────────────────────────────────────────────────

function PaymentPlanEditor({
  template,
  canManage,
}: {
  template: CompanyTemplatesResponse['paymentPlan'];
  canManage: boolean;
}) {
  const t = useTranslations('platform.templates');
  const save = useSavePaymentPlanTemplate();
  const reset = useResetCompanyTemplate();
  const [rows, setRows] = useState<PaymentPlanTemplateRow[]>(() => template.rows.map((r) => ({ ...r })));

  const dirty = JSON.stringify(rows) !== JSON.stringify(template.rows);
  // Cents arithmetic keeps 33.33 + 33.33 + 33.34 an exact 100.
  const totalCents = rows.reduce((sum, r) => sum + Math.round((Number(r.percentage) || 0) * 100), 0);
  const balanced = totalCents === 10_000;
  const readOnly = !canManage;
  const update = (i: number, patch: Partial<PaymentPlanTemplateRow>) =>
    setRows((current) => current.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const problems = problemsOf(save.error);

  return (
    <Panel
      title={t('paymentPlan.title')}
      sub={t('paymentPlan.sub')}
      action={<SourceBadge isDefault={template.isDefault} />}
    >
      {problems.length > 0 ? <Alert variant="error" messages={problems} className="mb-4" /> : null}
      <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-[560px] text-body-sm">
        <thead>
          <tr className="text-start text-caption text-muted-foreground">
            <th scope="col" className="w-10 pb-2 text-start font-medium">#</th>
            <th scope="col" className="pb-2 text-start font-medium">{t('paymentPlan.stage')}</th>
            <th scope="col" className="w-28 pb-2 text-start font-medium">{t('paymentPlan.percent')}</th>
            <th scope="col" className="w-24 pb-2 text-start font-medium">{t('paymentPlan.advance')}</th>
            {canManage ? <th scope="col" className="w-32 pb-2"><span className="sr-only">{t('actions')}</span></th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const label = row.name || t('paymentPlan.stageN', { n: i + 1 });
            return (
              <tr key={i} className="border-t border-border">
                <td className="py-2 tabular-nums text-muted-foreground">{i + 1}</td>
                <td className="py-2 pe-3">
                  <Input
                    value={row.name}
                    readOnly={readOnly}
                    aria-label={t('paymentPlan.stageName', { n: i + 1 })}
                    onChange={(e) => update(i, { name: e.target.value })}
                    maxLength={120}
                  />
                </td>
                <td className="py-2 pe-3">
                  <div className="flex items-center gap-1">
                    <Input
                      value={row.percentage}
                      readOnly={readOnly}
                      inputMode="decimal"
                      className="text-end tabular-nums"
                      aria-label={t('paymentPlan.stagePercent', { name: label })}
                      onChange={(e) => update(i, { percentage: e.target.value.replace(/[^0-9.]/g, '') })}
                    />
                    <span className="text-muted-foreground">%</span>
                  </div>
                </td>
                <td className="py-2">
                  <Checkbox
                    checked={row.isAdvance}
                    disabled={readOnly}
                    aria-label={t('paymentPlan.isAdvance', { name: label })}
                    // One advance at most: ticking a stage clears the others.
                    onChange={(e) =>
                      setRows((current) =>
                        current.map((r, j) => ({ ...r, isAdvance: j === i ? e.target.checked : false })),
                      )
                    }
                  />
                </td>
                {canManage ? (
                  <td className="py-2 text-end whitespace-nowrap">
                    <RowMoveButtons index={i} count={rows.length} onMove={(a, b) => setRows((c) => move(c, a, b))} disabled={false} label={label} />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={rows.length === 1}
                      onClick={() => setRows((c) => c.filter((_, j) => j !== i))}
                      aria-label={t('remove', { name: label })}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </Button>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      {canManage ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          disabled={rows.length >= 20}
          onClick={() => setRows((c) => [...c, { name: '', percentage: '', isAdvance: false }])}
        >
          <Plus size={16} aria-hidden="true" /> {t('paymentPlan.add')}
        </Button>
      ) : null}
      <EditorFooter
        dirty={dirty}
        isDefault={template.isDefault}
        canManage={canManage}
        saving={save.isPending}
        resetting={reset.isPending}
        onSave={() => save.mutate({ rows })}
        onDiscard={() => {
          save.reset();
          setRows(template.rows.map((r) => ({ ...r })));
        }}
        onReset={() => reset.mutate('payment-plan')}
        summary={
          <p className={cn('text-body-sm font-medium tabular-nums', balanced ? 'text-success' : 'text-danger')}>
            {balanced
              ? t('paymentPlan.totalOk')
              : t('paymentPlan.totalOff', { total: (totalCents / 100).toString() })}
          </p>
        }
      />
    </Panel>
  );
}

// ─── Building schedule ───────────────────────────────────────────────────────

function ScheduleEditor({
  template,
  canManage,
}: {
  template: CompanyTemplatesResponse['schedule'];
  canManage: boolean;
}) {
  const t = useTranslations('platform.templates');
  const save = useSaveScheduleTemplate();
  const reset = useResetCompanyTemplate();
  const [phases, setPhases] = useState<ScheduleTemplatePhaseDto[]>(() => template.phases.map((p) => ({ ...p })));

  const dirty = JSON.stringify(phases) !== JSON.stringify(template.phases);
  const totalDays = phases.reduce((sum, p) => sum + (Number.isFinite(p.durationDays) ? p.durationDays : 0), 0);
  const readOnly = !canManage;
  const update = (i: number, patch: Partial<ScheduleTemplatePhaseDto>) =>
    setPhases((current) => current.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const problems = problemsOf(save.error);

  return (
    <Panel
      title={t('schedule.title')}
      sub={t('schedule.sub')}
      action={<SourceBadge isDefault={template.isDefault} />}
    >
      {problems.length > 0 ? <Alert variant="error" messages={problems} className="mb-4" /> : null}
      <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-[560px] text-body-sm">
        <thead>
          <tr className="text-caption text-muted-foreground">
            <th scope="col" className="w-16 pb-2 text-start font-medium">{t('schedule.code')}</th>
            <th scope="col" className="pb-2 text-start font-medium">{t('schedule.phase')}</th>
            <th scope="col" className="w-28 pb-2 text-start font-medium">{t('schedule.days')}</th>
            <th scope="col" className="w-32 pb-2 text-start font-medium">{t('schedule.datesOnly')}</th>
            {canManage ? <th scope="col" className="w-32 pb-2"><span className="sr-only">{t('actions')}</span></th> : null}
          </tr>
        </thead>
        <tbody>
          {phases.map((phase, i) => {
            const label = phase.name || t('schedule.phaseN', { n: i + 1 });
            return (
              <tr key={i} className="border-t border-border">
                <td className="py-2 font-mono text-caption text-muted-foreground">
                  WP-{String(i + 1).padStart(2, '0')}
                </td>
                <td className="py-2 pe-3">
                  <Input
                    value={phase.name}
                    readOnly={readOnly}
                    aria-label={t('schedule.phaseName', { n: i + 1 })}
                    onChange={(e) => update(i, { name: e.target.value })}
                    maxLength={120}
                  />
                </td>
                <td className="py-2 pe-3">
                  <Input
                    type="number"
                    min={1}
                    max={365}
                    value={Number.isFinite(phase.durationDays) ? phase.durationDays : ''}
                    readOnly={readOnly}
                    className="text-end tabular-nums"
                    aria-label={t('schedule.phaseDays', { name: label })}
                    onChange={(e) => update(i, { durationDays: e.target.value === '' ? Number.NaN : Number(e.target.value) })}
                  />
                </td>
                <td className="py-2">
                  <Checkbox
                    checked={phase.scheduleOnly}
                    disabled={readOnly}
                    aria-label={t('schedule.isDatesOnly', { name: label })}
                    onChange={(e) => update(i, { scheduleOnly: e.target.checked })}
                  />
                </td>
                {canManage ? (
                  <td className="py-2 text-end whitespace-nowrap">
                    <RowMoveButtons index={i} count={phases.length} onMove={(a, b) => setPhases((c) => move(c, a, b))} disabled={false} label={label} />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={phases.length === 1}
                      onClick={() => setPhases((c) => c.filter((_, j) => j !== i))}
                      aria-label={t('remove', { name: label })}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </Button>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      <p className="mt-2 text-caption text-muted-foreground">{t('schedule.datesOnlyHint')}</p>
      {canManage ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          disabled={phases.length >= 30}
          onClick={() => setPhases((c) => [...c, { name: '', durationDays: 30, scheduleOnly: false }])}
        >
          <Plus size={16} aria-hidden="true" /> {t('schedule.add')}
        </Button>
      ) : null}
      <EditorFooter
        dirty={dirty}
        isDefault={template.isDefault}
        canManage={canManage}
        saving={save.isPending}
        resetting={reset.isPending}
        // NaN (an emptied field) goes to the server as null so it reports the field, not a 500.
        onSave={() => save.mutate({ phases: phases.map((p) => ({ ...p, durationDays: Number.isFinite(p.durationDays) ? p.durationDays : (null as unknown as number) })) })}
        onDiscard={() => {
          save.reset();
          setPhases(template.phases.map((p) => ({ ...p })));
        }}
        onReset={() => reset.mutate('schedule')}
        summary={
          <p className="text-body-sm text-muted-foreground tabular-nums">
            {t('schedule.total', { phases: phases.length, days: totalDays })}
          </p>
        }
      />
    </Panel>
  );
}
