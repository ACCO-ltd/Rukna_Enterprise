'use client';

/**
 * Material request creation (§12.5).
 *
 * Two steps, because a header and a line table on one screen is unusable at 375px and
 * because the header decides what the lines can say — an ORGANIZATION-scoped request
 * cannot carry a project, and the BOQ and spend fields on a line only make sense once the
 * scope is known.
 *
 * Everything is validated against `material-request.service.ts`'s own rules before the
 * request is sent, so the user never sees a `400` they cannot connect to a field.
 */

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Alert, Button, DatePicker, FormField, RadioGroup, Select, Textarea } from '@erp/ui';

import { ApiError } from '@/lib/api-client';
import { QUANTITY_SCALE, parseMinorUnits } from '@/lib/money';

import { useCreateMaterialRequest, useSpendCategories } from '../hooks/use-procurement';
import { useProjects } from '@/features/projects/hooks/use-projects';
import { quantityToApi, validateMrScope } from '../quantities';
import type { CreateMrLinePayload, MaterialRequestScope } from '../types';
import { MrLineEditor, emptyMrLine, mrLineError, type MrLineDraft } from './mr-line-editor';

/** Today in the `YYYY-MM-DD` shape `@IsDateString()` accepts. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function MrForm() {
  const t = useTranslations('procurement.mr');
  const tc = useTranslations('procurement.common');
  const router = useRouter();

  const [step, setStep] = useState<1 | 2>(1);
  const [scope, setScope] = useState<MaterialRequestScope>('PROJECT');
  const [projectId, setProjectId] = useState('');
  const [requestedDate, setRequestedDate] = useState(today);
  const [requiredByDate, setRequiredByDate] = useState('');
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<MrLineDraft[]>([emptyMrLine('line-1')]);
  const [showErrors, setShowErrors] = useState(false);

  const ids = {
    project: useId(),
    requested: useId(),
    required: useId(),
    description: useId(),
  };

  const create = useCreateMaterialRequest();
  const projects = useProjects();
  const spendCategories = useSpendCategories();

  const scopeError = validateMrScope(scope, projectId || null);
  const lineErrors = lines.map(mrLineError);
  const hasLineError = lineErrors.some((e) => e !== null);

  function goToLines() {
    setShowErrors(true);
    if (scopeError) return;
    setShowErrors(false);
    setStep(2);
  }

  function handleSubmit() {
    setShowErrors(true);
    if (scopeError || hasLineError) return;

    const payload = {
      requestScope: scope,
      // Rule MR-002: ORGANIZATION scope must not carry a project at all — sending null
      // rather than omitting it is also rejected, so the key is absent entirely.
      ...(scope === 'PROJECT' ? { projectId } : {}),
      requestedDate,
      ...(requiredByDate ? { requiredByDate } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
      lines: lines.map((line): CreateMrLinePayload => {
        const minor = parseMinorUnits(line.quantity, QUANTITY_SCALE) ?? 0;
        return {
          lineType: line.lineType,
          description: line.description.trim(),
          // Required on every line, and ignored on MATERIAL lines where the server uses
          // the material's own base unit (P7). Sending the material's code is the honest
          // value; it is discarded either way.
          uomCode: line.material?.baseUom?.code ?? line.uomCode,
          requestedQuantity: quantityToApi(minor),
          ...(line.material ? { materialCode: line.material.code } : {}),
          ...(line.spendCategoryId ? { spendCategoryId: line.spendCategoryId } : {}),
        };
      }),
    };

    create.mutate(payload, {
      onSuccess: (mr) => router.push(`/procurement/requests/${mr.id}`),
    });
  }

  const serverError =
    create.error instanceof ApiError ? create.error.message : create.error ? tc('loadFailed') : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t('createTitle')}
        </h1>
        <ol className="mt-3 flex gap-4 text-sm" aria-label={t('createTitle')}>
          <li aria-current={step === 1 ? 'step' : undefined}>
            <span className={step === 1 ? 'font-semibold text-foreground' : 'text-muted-foreground'}>
              1. {t('stepHeader')}
            </span>
          </li>
          <li aria-current={step === 2 ? 'step' : undefined}>
            <span className={step === 2 ? 'font-semibold text-foreground' : 'text-muted-foreground'}>
              2. {t('stepLines')}
            </span>
          </li>
        </ol>
      </div>

      {step === 1 ? (
        <div className="max-w-xl space-y-4">
          <RadioGroup
            label={t('scope')}
            name="scope"
            value={scope}
            options={[
              { value: 'PROJECT', label: t('scopeProject') },
              { value: 'ORGANIZATION', label: t('scopeOrganization') },
            ]}
            onChange={(value) => {
              setScope(value);
              if (value === 'ORGANIZATION') setProjectId('');
            }}
          />

          {scope === 'PROJECT' ? (
            <FormField
              htmlFor={ids.project}
              label={tc('project')}
              error={showErrors && scopeError ? t(`scopeError.${scopeError}`) : undefined}
            >
              <Select
                id={ids.project}
                value={projectId}
                onChange={(value) => setProjectId(value)}
              >
                <option value="">{t('selectProject')}</option>
                {(projects.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} · {p.name}
                  </option>
                ))}
              </Select>
            </FormField>
          ) : null}

          <FormField htmlFor={ids.requested} label={t('requestedDate')}>
            <DatePicker
              id={ids.requested}
              value={requestedDate}
              onChange={(value) => setRequestedDate(value)}
            />
          </FormField>

          <FormField htmlFor={ids.required} label={`${t('requiredBy')} (${tc('optional')})`}>
            <DatePicker
              id={ids.required}
              value={requiredByDate}
              onChange={(value) => setRequiredByDate(value)}
            />
          </FormField>

          <FormField
            htmlFor={ids.description}
            label={`${tc('description')} (${tc('optional')})`}
          >
            <Textarea
              id={ids.description}
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </FormField>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => router.back()}>
              {tc('cancel')}
            </Button>
            <Button type="button" onClick={goToLines}>
              {tc('next')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <MrLineEditor
            lines={lines}
            onChange={setLines}
            spendCategories={spendCategories.data ?? []}
            showErrors={showErrors}
          />

          {serverError ? <Alert variant="error" messages={[serverError]} /> : null}

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setStep(1)}>
              {tc('back')}
            </Button>
            <Button type="button" onClick={handleSubmit} disabled={create.isPending}>
              {tc('create')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
