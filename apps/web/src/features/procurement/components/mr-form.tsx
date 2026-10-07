'use client';

/**
 * New material request — one page, no wizard.
 *
 * The action bar (Save draft · Discard · lifecycle), the document's identity, then two sections:
 * what the request is for, and the items. Saving creates the DRAFT and opens the saved request,
 * where it is submitted for approval — submitting is a separate command, not part of saving.
 *
 * Every rule the server enforces on create is checked here first, inline under its field and
 * counted in the error summary, so a refusal is never a `400` the requester cannot place. The
 * request date is the server's — it is stamped on save and not sent.
 */

import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Button,
  ChoiceCards,
  Combobox,
  DatePicker,
  DocumentIdentity,
  FormActionBar,
  FormField,
  Input,
  LifecycleStepper,
  Select,
  Textarea,
} from '@erp/ui';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { FormErrorSummary, type FormFieldError } from '@/components/form-error-summary';
import { useModuleTrail } from '@/components/layout/module-chrome';
import { PROCUREMENT_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { useProjects } from '@/features/projects/hooks/use-projects';
import { ApiError } from '@/lib/api-client';
import { formatMoney } from '@/lib/format';

import {
  useCreateMaterialRequest,
  useMaterials,
  useSpendCategories,
  useUoms,
} from '../hooks/use-procurement';
import type { CreateMaterialRequestPayload, MaterialRequestPriority, MaterialRequestScope } from '../types';
import {
  MrItemsEditor,
  emptyMrItem,
  mrItemControlId,
  mrItemErrors,
  mrItemsTotal,
  toMrLinePayload,
  type MrItemDraft,
} from './mr-line-editor';

const STAGES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'ORDERED'] as const;
const PRIORITIES: MaterialRequestPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

const IDS = {
  project: 'mr-project',
  neededBy: 'mr-needed-by',
  priority: 'mr-priority',
  title: 'mr-title',
  note: 'mr-note',
} as const;

export function MrForm() {
  const t = useTranslations('procurement.mr.create');
  const tErr = useTranslations('procurement.mr.create.errors');
  const tCol = useTranslations('procurement.mr.create.columns');
  const tc = useTranslations('procurement.common');
  const tForm = useTranslations('common.formState');
  const tCommon = useTranslations('common');
  const tPriority = useTranslations('procurement.project.requirements.priority');
  // The module header owns the page's h1 (ADR-035); the form names itself in the breadcrumb.
  useModuleTrail(t('title'));
  const router = useRouter();
  const { can } = usePermissions();
  const moneyVisible = can(PROCUREMENT_PERMISSIONS.viewCommitments);
  // Started from a project's Procurement tab (`?projectId=`): the project is already chosen,
  // and saving returns to that project's requests.
  const fromProjectId = useSearchParams()?.get('projectId') ?? '';

  const [scope, setScope] = useState<MaterialRequestScope>('PROJECT');
  const [projectId, setProjectId] = useState(fromProjectId);
  const [neededBy, setNeededBy] = useState('');
  const [priority, setPriority] = useState<MaterialRequestPriority>('NORMAL');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const nextKey = useRef(2);
  const [items, setItems] = useState<MrItemDraft[]>([emptyMrItem('item-1')]);
  const [showErrors, setShowErrors] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);

  const create = useCreateMaterialRequest();
  const projects = useProjects();
  const materials = useMaterials();
  const uoms = useUoms();
  const spendCategories = useSpendCategories();

  const projectOptions = useMemo(
    () =>
      (projects.data ?? []).map((p) => ({ value: p.id, label: p.name, hint: p.code })),
    [projects.data],
  );

  const dirty =
    scope !== 'PROJECT' ||
    projectId !== fromProjectId ||
    neededBy !== '' ||
    priority !== 'NORMAL' ||
    title.trim() !== '' ||
    note.trim() !== '' ||
    items.length > 1 ||
    items.some((item) => item.material !== null || item.description || item.quantity || item.estimatedUnitPrice);

  const projectError = scope === 'PROJECT' && !projectId ? tErr('project') : undefined;
  const itemErrors = items.map(mrItemErrors);
  const hasErrors = Boolean(projectError) || itemErrors.some((e) => Object.keys(e).length > 0);

  const summaryErrors: FormFieldError[] = [];
  if (projectError) summaryErrors.push({ label: t('project'), fieldId: IDS.project, message: projectError });
  itemErrors.forEach((errors, i) => {
    const label = t('lineTitle', { n: i + 1 });
    if (errors.item) {
      summaryErrors.push({ label: `${label} · ${tCol('item')}`, fieldId: mrItemControlId('item', i), message: tErr('item') });
    } else if (errors.unit) {
      summaryErrors.push({ label: `${label} · ${tCol('unit')}`, fieldId: mrItemControlId('unit', i), message: tErr('unit') });
    }
    if (errors.quantity) {
      summaryErrors.push({
        label: `${label} · ${tCol('quantity')}`,
        fieldId: mrItemControlId('quantity', i),
        message: tErr('quantity'),
      });
    }
  });
  const serverError =
    create.error instanceof ApiError ? create.error.message : create.error ? tc('loadFailed') : null;
  const showSummary = (showErrors && summaryErrors.length > 0) || serverError !== null;

  const total = moneyVisible ? mrItemsTotal(items) : null;

  function buildPayload(): CreateMaterialRequestPayload {
    const lines = items.map(toMrLinePayload);
    return {
      requestScope: scope,
      // Rule MR-002: overhead must not carry a project at all — the key is absent, not null.
      ...(scope === 'PROJECT' ? { projectId } : {}),
      ...(neededBy ? { requiredByDate: neededBy } : {}),
      ...(title.trim() ? { title: title.trim() } : {}),
      // NORMAL is the server's default; sending it would be noise.
      ...(priority !== 'NORMAL' ? { priority } : {}),
      // An amount needs its currency; sent only when a line carries an estimate.
      ...(lines.some((line) => line.estimatedUnitPrice !== undefined) ? { currencyCode: 'USD' } : {}),
      ...(note.trim() ? { notes: note.trim() } : {}),
      lines,
    };
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setShowErrors(true);
    if (hasErrors) {
      requestAnimationFrame(() => summaryRef.current?.scrollIntoView({ block: 'start' }));
      return;
    }
    create.mutate(buildPayload(), {
      onSuccess: (mr) =>
        router.push(
          fromProjectId && scope === 'PROJECT' && projectId === fromProjectId
            ? `/projects/${projectId}/procurement/requests`
            : `/procurement/requests/${mr.id}`,
        ),
    });
  }

  const leave = () =>
    router.push(fromProjectId ? `/projects/${fromProjectId}/procurement/requests` : '/procurement/requests');

  const addItem = () => {
    const key = `item-${nextKey.current}`;
    nextKey.current += 1;
    setItems((current) => [...current, emptyMrItem(key)]);
  };

  return (
    <>
      <form onSubmit={handleSubmit} noValidate>
        <FormActionBar
          save={
            <Button type="submit" loading={create.isPending} loadingText={t('saving')}>
              {t('saveDraft')}
            </Button>
          }
          discard={
            <Button type="button" variant="ghost" onClick={() => (dirty ? setConfirmLeave(true) : leave())}>
              {t('discard')}
            </Button>
          }
          saveState={dirty ? 'dirty' : 'new'}
          saveStateLabels={{ new: tForm('new'), dirty: tForm('dirty'), clean: tForm('clean') }}
          lifecycle={
            <LifecycleStepper
              steps={STAGES.map((stage) => ({ key: stage, label: t(`stages.${stage}`) }))}
              current="DRAFT"
              stepOfLabel={(n, totalSteps) => t('stepOf', { n, total: totalSteps })}
            />
          }
        />

        <div className="space-y-8">
          <DocumentIdentity eyebrow={t('eyebrow')} title={t('title')} subtitle={t('intro')} className="mb-0" />

          <div ref={summaryRef} className="scroll-mt-32">
            {showSummary ? (
              <FormErrorSummary
                errors={showErrors ? summaryErrors : []}
                formErrors={serverError ? [serverError] : []}
              />
            ) : null}
          </div>

          <section aria-labelledby="mr-request-section" className="space-y-4">
            <h2 id="mr-request-section" className="border-b border-border pb-2 text-body font-semibold text-foreground">
              {t('requestSection')}
            </h2>

            <ChoiceCards<MaterialRequestScope>
              label={t('forLabel')}
              value={scope}
              columns={2}
              onChange={(value) => {
                setScope(value);
                if (value === 'ORGANIZATION') setProjectId('');
              }}
              options={[
                { value: 'PROJECT', label: t('forProject'), hint: t('forProjectHint') },
                { value: 'ORGANIZATION', label: t('forOverhead'), hint: t('forOverheadHint') },
              ]}
            />

            <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              {scope === 'PROJECT' ? (
                <FormField
                  htmlFor={IDS.project}
                  label={t('project')}
                  required
                  error={showErrors ? projectError : undefined}
                  className="sm:col-span-2"
                >
                  <Combobox
                    id={IDS.project}
                    value={projectId}
                    onChange={setProjectId}
                    options={projectOptions}
                    placeholder={t('projectPlaceholder')}
                    searchPlaceholder={t('projectSearch')}
                    emptyLabel={t('projectEmpty')}
                    loading={projects.isPending}
                    invalid={showErrors && Boolean(projectError)}
                    aria-required
                  />
                </FormField>
              ) : null}

              <FormField
                htmlFor={IDS.neededBy}
                label={`${t('neededBy')} (${t('optional')})`}
                hint={t('neededByHint')}
              >
                <DatePicker id={IDS.neededBy} value={neededBy} onChange={(value) => setNeededBy(value)} />
              </FormField>

              <FormField htmlFor={IDS.priority} label={t('priority')}>
                <Select
                  id={IDS.priority}
                  value={priority}
                  onChange={(value) => setPriority(value as MaterialRequestPriority)}
                >
                  {PRIORITIES.map((value) => (
                    <option key={value} value={value}>
                      {tPriority(value)}
                    </option>
                  ))}
                </Select>
              </FormField>

              <FormField
                htmlFor={IDS.title}
                label={`${t('titleField')} (${t('optional')})`}
                hint={t('titleHint')}
                className="sm:col-span-2"
              >
                <Input id={IDS.title} value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} />
              </FormField>
            </div>
          </section>

          <section aria-labelledby="mr-items-section" className="space-y-4">
            <h2 id="mr-items-section" className="border-b border-border pb-2 text-body font-semibold text-foreground">
              {t('itemsSection')}
            </h2>

            <MrItemsEditor
              items={items}
              onChange={setItems}
              materials={materials.data ?? []}
              uoms={uoms.data ?? []}
              spendCategories={spendCategories.data ?? []}
              showErrors={showErrors}
              moneyVisible={moneyVisible}
              onAdd={addItem}
            />

            {moneyVisible ? (
              <p className="flex items-baseline justify-end gap-3 text-body" aria-live="polite">
                <span className="text-muted-foreground">{t('estimatedTotal')}</span>
                <span className="font-semibold tabular-nums text-foreground">
                  {total === null ? t('notEstimated') : formatMoney(total, 'USD')}
                </span>
              </p>
            ) : null}

            <FormField htmlFor={IDS.note} label={`${t('note')} (${t('optional')})`} hint={t('noteHint')}>
              <Textarea id={IDS.note} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
            </FormField>
          </section>
        </div>
      </form>

      {confirmLeave ? (
        <ConfirmActionDialog
          title={tCommon('unsavedChanges.title')}
          description={tCommon('unsavedChanges.body')}
          confirmLabel={tCommon('unsavedChanges.leave')}
          isPending={false}
          onConfirm={leave}
          onDismiss={() => setConfirmLeave(false)}
        />
      ) : null}
    </>
  );
}
