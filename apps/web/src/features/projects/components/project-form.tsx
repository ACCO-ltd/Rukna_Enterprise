'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ClientStatus, ProjectCategory } from '@erp/types';
import {
  Alert,
  Button,
  DatePicker,
  FormField,
  FormSection,
  Input,
  Select,
  Textarea,
} from '@erp/ui';

import { FormActions } from '@/components/form-actions';
import { FormErrorSummary } from '@/components/form-error-summary';
import { ApiError } from '@/lib/api-client';

import { useCreateProject } from '../hooks/use-create-project';
import { useUpdateProject } from '../hooks/use-update-project';
import { ClientForm } from '@/features/clients/components/client-form';
import { usePermissions } from '@/features/auth/permissions/can';
import { useClients } from '@/features/clients/hooks/use-clients';
import { DistrictSelect } from '@/features/districts/components/district-select';
import { useDistricts } from '@/features/districts/hooks/use-districts';
import { ProjectSubtypeSelect } from '@/features/project-types/components/project-subtype-select';
import { useSession } from '@/features/auth/session/use-session';
import {
  EMPTY_PROJECT_FORM,
  toCreateProjectPayload,
  toFormValues,
  toUpdateProjectPayload,
  type ProjectFormValues,
} from '../project-form-payload';
import type { ProjectDetail } from '../types';

// ─── Wizard step definitions ──────────────────────────────────────────────────

function buildSchema(
  t: ReturnType<typeof useTranslations<'platform.projects.create'>>,
  tTypes: ReturnType<typeof useTranslations<'projectTypes'>>,
) {
  return z
    .object({
      code: z.string(),
      name: z.string().trim().min(1, t('nameRequired')).max(255, t('nameTooLong')),
      districtId: z.string().trim().min(1, t('districtRequired')),
      // Project type (PTD1-PTD5): category is required. Held as a string that is `''` until
      // picked; the object-level refine below rejects `''` with `categoryRequired`, so it
      // surfaces on Next before step 1 can advance. Kept as a string (not z.enum) so the form
      // value type `ProjectCategory | ''` matches the resolver's inferred shape.
      category: z.union([z.nativeEnum(ProjectCategory), z.literal('')]),
      subtypeId: z.string(),
      description: z.string(),
      clientName: z.string(),
      clientId: z.string(),
      commercialModel: z.enum(['CLIENT_CONTRACT', 'INTERNAL_CAPITAL']),
      participationModel: z.enum(['SOLE', 'JOINT_VENTURE']),
      location: z.string().max(255, t('nameTooLong')),
      contractValue: z.string(),
      currency: z.string(),
      startDate: z.string(),
      expectedEndDate: z.string(),
    })
    .refine((v) => v.category !== '', {
      message: tTypes('form.categoryRequired'),
      path: ['category'],
    })
    .refine((v) => v.commercialModel !== 'CLIENT_CONTRACT' || v.clientId.length > 0, {
      message: t('clientRequired'),
      path: ['clientId'],
    })
    .refine((v) => !v.startDate || !v.expectedEndDate || v.expectedEndDate >= v.startDate, {
      message: t('endBeforeStart'),
      path: ['expectedEndDate'],
    });
}

// ─── Shared props ─────────────────────────────────────────────────────────────

interface ProjectFormProps {
  project?: ProjectDetail;
}

// ─── Public export ────────────────────────────────────────────────────────────

export function ProjectForm({ project }: ProjectFormProps = {}) {
  const isEdit = project !== undefined;

  return isEdit ? <ProjectEditForm project={project} /> : <ProjectCreateForm />;
}

// ─── Create wizard ────────────────────────────────────────────────────────────

function ProjectCreateForm() {
  const t = useTranslations('platform.projects.create');
  const tTypes = useTranslations('projectTypes');
  const searchParams = useSearchParams();
  const { can } = usePermissions();
  const [addingClient, setAddingClient] = useState(false);
  const { data: clients = [], isPending: clientsPending, isError: clientsFailed } = useClients();

  const lockedClientId = searchParams.get('clientId') ?? '';
  const isClientLocked = lockedClientId.length > 0;
  const lockedClient = clients.find((c) => c.id === lockedClientId);
  const lockedClientName = lockedClient?.name ?? '';

  // When the URL carries a clientId but no matching client loaded: show an actionable error
  // rather than a blank locked field that silently submits an invalid reference.
  const isLockedClientNotFound = isClientLocked && !clientsPending && !lockedClientName;
  const isLockedClientInactive =
    isClientLocked &&
    !clientsPending &&
    !!lockedClient &&
    lockedClient.status === ClientStatus.INACTIVE;

  const create = useCreateProject();
  const { isPending, error } = create;

  const schema = buildSchema(t, tTypes);
  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { ...EMPTY_PROJECT_FORM, clientId: lockedClientId },
  });
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isDirty },
  } = form;
  const commercialModel = useWatch({ control: form.control, name: 'commercialModel' });
  // Project type (PTD1-PTD5): the chosen category scopes the subtype picker. Changing it clears
  // any selected subtype — a subtype from the old category can never be paired with the new one.
  const category = useWatch({ control: form.control, name: 'category' });

  // ADR-025: district drives the project code. Only active districts are offered.
  const { data: districts = [] } = useDistricts(true);
  const districtId = useWatch({ control: form.control, name: 'districtId' });
  const startDate = useWatch({ control: form.control, name: 'startDate' });
  const selectedDistrict = districts.find((d) => d.id === districtId);
  const { user } = useSession();
  const codePreview = selectedDistrict
    ? `${(user?.tenantSlug ?? '').toUpperCase()}-${selectedDistrict.code}-${String(
        new Date().getFullYear(),
      ).slice(-2)}-####`
    : '';

  // Warn the browser before unloading when the form has unsaved entries that
  // have not yet been submitted successfully.
  useEffect(() => {
    if (!isDirty || create.isSuccess) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty, create.isSuccess]);

  const apiMessages = error instanceof ApiError && error.messages.length > 0 ? error.messages : [];
  const fieldErrors = [
    ...(errors.name
      ? [{ label: t('nameLabel'), fieldId: 'project-name', message: errors.name.message ?? '' }]
      : []),
    ...(errors.districtId
      ? [
          {
            label: t('districtLabel'),
            fieldId: 'project-district',
            message: errors.districtId.message ?? '',
          },
        ]
      : []),
    ...(errors.category
      ? [
          {
            label: tTypes('form.categoryLabel'),
            fieldId: 'project-category',
            message: errors.category.message ?? '',
          },
        ]
      : []),
    ...(errors.clientId
      ? [
          {
            label: t('clientNameLabel'),
            fieldId: 'project-clientId',
            message: errors.clientId.message ?? '',
          },
        ]
      : []),
    ...(errors.expectedEndDate
      ? [
          {
            label: t('expectedEndDateLabel'),
            fieldId: 'project-expectedEndDate',
            message: errors.expectedEndDate.message ?? '',
          },
        ]
      : []),
  ];

  const onSubmit = (values: ProjectFormValues) => {
    if (isPending || isLockedClientInactive || clientsPending || clientsFailed) return;
    create.mutate(toCreateProjectPayload(values));
  };

  if (addingClient)
    return (
      <div className="space-y-4">
        <h2 className="text-h2 font-semibold">{t('newClient')}</h2>
        <ClientForm
          onCancel={() => setAddingClient(false)}
          onCreated={(client) => {
            setValue('clientId', client.id, { shouldDirty: true, shouldValidate: true });
            setAddingClient(false);
          }}
        />
      </div>
    );

  // Only offer ACTIVE clients in the dropdown; INACTIVE ones cannot receive new projects.
  const activeClients = clients.filter((c) => c.status === ClientStatus.ACTIVE);

  // Show an actionable error if the clientId param points to a non-existent client.
  if (isLockedClientNotFound) {
    return (
      <div className="space-y-4">
        <Alert variant="error" messages={[t('clientNotFound')]} />
        <Button asChild variant="outline">
          <Link href="/clients">{t('wizard.backToClients')}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {clientsFailed ? <Alert variant="error" messages={[t('clientsLoadFailed')]} /> : null}
      {/* Inactive client warning — non-blocking; the API accepts it */}
      {isLockedClientInactive ? (
        <Alert variant="warning" messages={[t('clientInactiveWarning')]} />
      ) : null}

      <form
        className="space-y-6 rounded-panel border border-border bg-surface p-5 sm:p-8"
        onSubmit={(e) => {
          void handleSubmit(onSubmit)(e);
        }}
        noValidate
      >
        <FormErrorSummary errors={fieldErrors} formErrors={apiMessages} />

        <FormSection
          title={t('identitySection')}
          description={t('identitySectionHint')}
          variant="plain"
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField
              htmlFor="project-name"
              label={t('nameLabel')}
              error={errors.name?.message}
              required
            >
              <Input id="project-name" placeholder={t('namePlaceholder')} {...register('name')} />
            </FormField>
            <FormField
              htmlFor="project-district"
              label={t('districtLabel')}
              error={errors.districtId?.message}
              hint={
                codePreview ? (
                  <>
                    {t('codePreview')}{' '}
                    <span className="font-mono text-foreground">{codePreview}</span>
                  </>
                ) : undefined
              }
              required
            >
              {/* DistrictSelect rather than a plain Select: twenty districts is past the
                    point a flat list is scannable, and the registry has to be extendable from
                    here — a project cannot be created without a district, so "ask an
                    administrator" is a dead end in the middle of the form. */}
              <Controller
                control={form.control}
                name="districtId"
                render={({ field }) => (
                  <DistrictSelect
                    id="project-district"
                    value={field.value}
                    onChange={field.onChange}
                    invalid={Boolean(errors.districtId)}
                  />
                )}
              />
            </FormField>

            {/* Project type (PTD1-PTD5): the required category, then its optional subtype. The
                  subtype picker is disabled until a category is chosen; changing the category
                  clears the subtype (a subtype belongs to exactly one category). */}
            <FormField
              htmlFor="project-category"
              label={tTypes('form.categoryLabel')}
              error={errors.category?.message}
              required
            >
              <Controller
                control={form.control}
                name="category"
                render={({ field }) => (
                  <Select
                    id="project-category"
                    value={field.value}
                    onChange={(value) => {
                      field.onChange(value);
                      setValue('subtypeId', '');
                    }}
                  >
                    <option value="">{tTypes('form.categoryPlaceholder')}</option>
                    {Object.values(ProjectCategory).map((value) => (
                      <option key={value} value={value}>
                        {tTypes(`categories.${value}`)}
                      </option>
                    ))}
                  </Select>
                )}
              />
            </FormField>

            <FormField htmlFor="project-subtype" label={tTypes('form.subtypeLabel')}>
              <Controller
                control={form.control}
                name="subtypeId"
                render={({ field }) => (
                  <ProjectSubtypeSelect
                    id="project-subtype"
                    category={category === '' ? undefined : category}
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
            </FormField>

            {commercialModel === 'CLIENT_CONTRACT' ? (
              <FormField
                htmlFor="project-clientId"
                label={t('clientNameLabel')}
                error={errors.clientId?.message}
                required
              >
                {isClientLocked ? (
                  <>
                    <input type="hidden" {...register('clientId')} />
                    <Input
                      id="project-clientId"
                      value={lockedClientName}
                      readOnly
                      className="bg-muted text-muted-foreground"
                    />
                  </>
                ) : (
                  <Controller
                    control={form.control}
                    name="clientId"
                    render={({ field }) => (
                      <Select id="project-clientId" value={field.value} onChange={field.onChange}>
                        <option value="">{t('selectClient')}</option>
                        {activeClients.map((client) => (
                          <option key={client.id} value={client.id}>
                            {client.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  />
                )}
                {!isClientLocked && can('manage:client') ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setAddingClient(true)}
                  >
                    {t('newClient')}
                  </Button>
                ) : null}
              </FormField>
            ) : null}

            <FormField
              htmlFor="project-location"
              label={t('locationLabel')}
              hint={t('locationHint')}
              error={errors.location?.message}
            >
              <Input
                id="project-location"
                placeholder={t('locationPlaceholder')}
                {...register('location')}
              />
            </FormField>
          </div>
        </FormSection>

        <details>
          <summary className="cursor-pointer text-body-sm font-medium text-foreground">
            {t('deliveryArrangement')}
          </summary>
          <div className="grid gap-5 pt-4 sm:grid-cols-2">
            {' '}
            <FormField
              htmlFor="project-commercial-model"
              label={t('commercialModelLabel')}
              required
            >
              <Controller
                control={form.control}
                name="commercialModel"
                render={({ field }) => (
                  <Select
                    id="project-commercial-model"
                    value={field.value}
                    onChange={field.onChange}
                  >
                    <option value="CLIENT_CONTRACT">{t('commercialModel.clientContract')}</option>
                    <option value="INTERNAL_CAPITAL">{t('commercialModel.internalCapital')}</option>
                  </Select>
                )}
              />
            </FormField>
            <FormField
              htmlFor="project-participation-model"
              label={t('participationModelLabel')}
              required
            >
              <Controller
                control={form.control}
                name="participationModel"
                render={({ field }) => (
                  <Select
                    id="project-participation-model"
                    value={field.value}
                    onChange={field.onChange}
                  >
                    <option value="SOLE">{t('participationModel.sole')}</option>
                    <option value="JOINT_VENTURE">{t('participationModel.jointVenture')}</option>
                  </Select>
                )}
              />
            </FormField>
          </div>
        </details>
        <FormSection
          title={t('scheduleSection')}
          description={t('scheduleSectionHint')}
          variant="plain"
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField
              htmlFor="project-startDate"
              label={t('startDateLabel')}
              error={errors.startDate?.message}
            >
              <Controller
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <DatePicker
                    id="project-startDate"
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
            </FormField>

            <FormField
              htmlFor="project-expectedEndDate"
              label={t('expectedEndDateLabel')}
              error={errors.expectedEndDate?.message}
            >
              <Controller
                control={form.control}
                name="expectedEndDate"
                render={({ field }) => (
                  <DatePicker
                    id="project-expectedEndDate"
                    value={field.value}
                    onChange={field.onChange}
                    min={startDate || undefined}
                  />
                )}
              />
            </FormField>
          </div>

          <FormField
            htmlFor="project-description"
            label={t('descriptionLabel')}
            error={errors.description?.message}
          >
            <Textarea id="project-description" {...register('description')} />
          </FormField>
        </FormSection>

        <FormActions
          submitLabel={t('submit')}
          isPending={isPending}
          disabled={isLockedClientInactive || clientsPending || clientsFailed}
          cancelHref={isClientLocked ? `/clients/${lockedClientId}` : '/projects'}
        />
      </form>
    </div>
  );
}

// ─── Step indicator ───────────────────────────────────────────────────────────

function ProjectEditForm({ project }: { project: ProjectDetail }) {
  const t = useTranslations('platform.projects.create');
  const tTypes = useTranslations('projectTypes');
  const tActions = useTranslations('common');
  const { data: clients = [] } = useClients();

  const update = useUpdateProject(project.id);
  const { isPending, error } = update;

  const schema = buildSchema(t, tTypes);
  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(schema),
    defaultValues: toFormValues(project),
  });
  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = form;
  const category = useWatch({ control, name: 'category' });
  const startDate = useWatch({ control, name: 'startDate' });

  const onSubmit = (values: ProjectFormValues) => {
    update.mutate(toUpdateProjectPayload(values));
  };

  const isDuplicateCode = error instanceof ApiError && error.status === 409;
  const apiMessages = error instanceof ApiError && error.messages.length > 0 ? error.messages : [];
  const fieldErrors = [
    ...(errors.name
      ? [{ label: t('nameLabel'), fieldId: 'project-name', message: errors.name.message ?? '' }]
      : []),
    ...(errors.category
      ? [
          {
            label: tTypes('form.categoryLabel'),
            fieldId: 'project-category',
            message: errors.category.message ?? '',
          },
        ]
      : []),
    ...(errors.expectedEndDate
      ? [
          {
            label: t('expectedEndDateLabel'),
            fieldId: 'project-expectedEndDate',
            message: errors.expectedEndDate.message ?? '',
          },
        ]
      : []),
  ];

  return (
    <form className="space-y-6 pb-24" onSubmit={handleSubmit(onSubmit)} noValidate>
      <FormErrorSummary
        errors={fieldErrors}
        formErrors={isDuplicateCode ? [t('duplicateCode')] : apiMessages}
      />

      <FormSection
        title={t('identitySection')}
        description={t('identitySectionHint')}
        variant="plain"
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField htmlFor="project-code" label={t('codeLabel')} hint={t('codeHint')}>
            <Input
              id="project-code"
              readOnly
              className="bg-muted text-muted-foreground"
              {...register('code')}
            />
          </FormField>

          <FormField
            htmlFor="project-clientId"
            label={t('clientNameLabel')}
            error={errors.clientId?.message}
          >
            <Controller
              control={form.control}
              name="clientId"
              render={({ field }) => (
                <Select id="project-clientId" value={field.value} onChange={field.onChange}>
                  <option value="">{t('currencyNone')}</option>
                  {clients
                    .filter((client) => client.status === ClientStatus.ACTIVE)
                    .map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                </Select>
              )}
            />
          </FormField>

          <FormField
            htmlFor="project-name"
            label={t('nameLabel')}
            error={errors.name?.message}
            required
          >
            <Input id="project-name" placeholder={t('namePlaceholder')} {...register('name')} />
          </FormField>

          {/* Project type (PTD1-PTD5): editable while DRAFT. Changing the category clears the
              subtype, exactly as on create. */}
          <FormField
            htmlFor="project-category"
            label={tTypes('form.categoryLabel')}
            error={errors.category?.message}
            required
          >
            <Controller
              control={control}
              name="category"
              render={({ field }) => (
                <Select
                  id="project-category"
                  value={field.value}
                  onChange={(value) => {
                    field.onChange(value);
                    setValue('subtypeId', '');
                  }}
                >
                  <option value="">{tTypes('form.categoryPlaceholder')}</option>
                  {Object.values(ProjectCategory).map((value) => (
                    <option key={value} value={value}>
                      {tTypes(`categories.${value}`)}
                    </option>
                  ))}
                </Select>
              )}
            />
          </FormField>

          <FormField htmlFor="project-subtype" label={tTypes('form.subtypeLabel')}>
            <Controller
              control={control}
              name="subtypeId"
              render={({ field }) => (
                <ProjectSubtypeSelect
                  id="project-subtype"
                  category={category === '' ? undefined : category}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </FormField>

          <FormField
            htmlFor="project-location"
            label={t('locationLabel')}
            hint={t('locationHint')}
            error={errors.location?.message}
          >
            <Input
              id="project-location"
              placeholder={t('locationPlaceholder')}
              {...register('location')}
            />
          </FormField>
        </div>
      </FormSection>

      <FormSection
        title={t('scheduleSection')}
        description={t('scheduleSectionHint')}
        variant="plain"
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            htmlFor="project-startDate"
            label={t('startDateLabel')}
            error={errors.startDate?.message}
          >
            <Controller
              control={control}
              name="startDate"
              render={({ field }) => (
                <DatePicker id="project-startDate" value={field.value} onChange={field.onChange} />
              )}
            />
          </FormField>

          <FormField
            htmlFor="project-expectedEndDate"
            label={t('expectedEndDateLabel')}
            error={errors.expectedEndDate?.message}
          >
            <Controller
              control={control}
              name="expectedEndDate"
              render={({ field }) => (
                <DatePicker
                  id="project-expectedEndDate"
                  value={field.value}
                  onChange={field.onChange}
                  min={startDate || undefined}
                />
              )}
            />
          </FormField>
        </div>
      </FormSection>

      <FormSection title={t('detailsSection')} variant="plain">
        <FormField
          htmlFor="project-description"
          label={t('descriptionLabel')}
          error={errors.description?.message}
        >
          <Textarea id="project-description" {...register('description')} />
        </FormField>
      </FormSection>

      <FormActions
        submitLabel={tActions('save')}
        isPending={isPending}
        cancelHref={`/projects/${project.id}`}
      />
    </form>
  );
}
