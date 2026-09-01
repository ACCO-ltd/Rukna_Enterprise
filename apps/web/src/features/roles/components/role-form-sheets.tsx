'use client';

import { useId, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, FormField, Input, Select, Textarea } from '@erp/ui';

import type { RoleSummary } from '@erp/types';
import { PermissionPicker } from '@/features/permissions/components/permission-picker';
import {
  FormBody,
  FormFooter,
  FormSheetShell,
  apiMessage,
} from '@/features/admin/components/form-sheet-shell';

import {
  useCreateRole,
  useRole,
  useRoles,
  useSetRolePermissions,
  useUpdateRole,
} from '../hooks/use-roles';

// ─── Create ──────────────────────────────────────────────────────────────────────

export function CreateRoleSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('platform.roles.form');
  const tc = useTranslations('common');
  const create = useCreateRole();
  const templates = useRoles();
  const ids = { name: useId(), purpose: useId(), template: useId(), description: useId() };
  const [permissionIds, setPermissionIds] = useState<string[]>([]);

  function close(next: boolean) {
    if (!next) {
      setPermissionIds([]);
      create.reset();
    }
    onOpenChange(next);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    const purpose = String(form.get('purpose') ?? '').trim();
    const templateRoleId = String(form.get('templateRoleId') ?? '');
    const description = String(form.get('description') ?? '').trim();
    if (!name || !purpose) return;

    create.mutate(
      {
        name,
        purpose,
        ...(templateRoleId ? { templateRoleId } : {}),
        ...(description ? { description } : {}),
        ...(permissionIds.length > 0 ? { permissionIds } : {}),
      },
      {
        onSuccess: () => {
          setPermissionIds([]);
          close(false);
        },
      },
    );
  }

  return (
    <FormSheetShell
      open={open}
      onOpenChange={close}
      title={t('createTitle')}
      description={t('createSubtitle')}
    >
      <FormBody onSubmit={handleSubmit}>
        <FormField htmlFor={ids.name} label={t('name')} required>
          <Input
            id={ids.name}
            name="name"
            required
            maxLength={100}
            autoComplete="off"
            disabled={create.isPending}
          />
        </FormField>

        <FormField htmlFor={ids.purpose} label={t('purpose')} required>
          <Textarea
            id={ids.purpose}
            name="purpose"
            rows={2}
            required
            maxLength={500}
            disabled={create.isPending}
          />
        </FormField>

        <FormField htmlFor={ids.template} label={t('template')}>
          <Select
            id={ids.template}
            name="templateRoleId"
            disabled={create.isPending || templates.isPending}
          >
            <option value="">{t('noTemplate')}</option>
            {(templates.data ?? []).map((role) => (
              <option key={role.id} value={role.id}>
                {role.name} ({role.kind})
              </option>
            ))}
          </Select>
        </FormField>

        <FormField htmlFor={ids.description} label={`${t('description')} (${tc('optional')})`}>
          <Textarea
            id={ids.description}
            name="description"
            rows={2}
            maxLength={500}
            disabled={create.isPending}
          />
        </FormField>

        <PermissionPicker
          selectedIds={permissionIds}
          onChange={setPermissionIds}
          disabled={create.isPending}
        />

        {create.error ? (
          <Alert variant="error" messages={[apiMessage(create.error, t('createFailed'))!]} />
        ) : null}

        <FormFooter
          onCancel={() => close(false)}
          cancelLabel={tc('cancel')}
          submitLabel={t('createSubmit')}
          pendingLabel={t('createPending')}
          pending={create.isPending}
        />
      </FormBody>
    </FormSheetShell>
  );
}

// ─── Edit ────────────────────────────────────────────────────────────────────────

export function EditRoleSheet({
  role,
  onOpenChange,
}: {
  role: RoleSummary | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('platform.roles.form');
  const tc = useTranslations('common');
  const update = useUpdateRole();
  const ids = { name: useId(), purpose: useId(), description: useId() };

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!role) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    const purpose = String(form.get('purpose') ?? '').trim();
    const description = String(form.get('description') ?? '').trim();
    if (!name || !purpose) return;

    update.mutate(
      { id: role.id, payload: { name, purpose, description } },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <FormSheetShell
      open={Boolean(role)}
      onOpenChange={(next) => {
        if (!next) update.reset();
        onOpenChange(next);
      }}
      title={t('editTitle')}
      description={role ? `${t('editSubtitle')} · ${role.name}` : t('editSubtitle')}
    >
      {role ? (
        <FormBody onSubmit={handleSubmit}>
          <FormField htmlFor={ids.name} label={t('name')} required>
            <Input
              id={ids.name}
              name="name"
              defaultValue={role.name}
              required
              maxLength={100}
              autoComplete="off"
              disabled={update.isPending}
            />
          </FormField>

          <FormField htmlFor={ids.purpose} label={t('purpose')} required>
            <Textarea
              id={ids.purpose}
              name="purpose"
              rows={2}
              required
              maxLength={500}
              defaultValue={role.purpose ?? ''}
              disabled={update.isPending}
            />
          </FormField>

          <FormField htmlFor={ids.description} label={`${t('description')} (${tc('optional')})`}>
            <Textarea
              id={ids.description}
              name="description"
              rows={2}
              maxLength={500}
              defaultValue={role.description ?? ''}
              disabled={update.isPending}
            />
          </FormField>

          {update.error ? (
            <Alert variant="error" messages={[apiMessage(update.error, t('editFailed'))!]} />
          ) : null}

          <FormFooter
            onCancel={() => onOpenChange(false)}
            cancelLabel={tc('cancel')}
            submitLabel={tc('save')}
            pendingLabel={t('savePending')}
            pending={update.isPending}
          />
        </FormBody>
      ) : null}
    </FormSheetShell>
  );
}

// ─── Manage permissions ──────────────────────────────────────────────────────────

export function ManagePermissionsSheet({
  role,
  onOpenChange,
}: {
  role: RoleSummary | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('platform.roles.form');
  const tc = useTranslations('common');
  const detail = useRole(role?.id ?? null);
  const setPermissions = useSetRolePermissions();

  // Seed the picker from the role's live permission set once it loads, per opened role.
  const [permissionIds, setPermissionIds] = useState<string[]>([]);
  const [seededFor, setSeededFor] = useState<string | null>(null);

  if (role && detail.data && detail.data.id === role.id && seededFor !== role.id) {
    setSeededFor(role.id);
    setPermissionIds(detail.data.permissions.map((p) => p.id));
  }

  function close(next: boolean) {
    if (!next) {
      setSeededFor(null);
      setPermissionIds([]);
      setPermissions.reset();
    }
    onOpenChange(next);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!role) return;
    setPermissions.mutate(
      { id: role.id, payload: { permissionIds } },
      { onSuccess: () => close(false) },
    );
  }

  const loading = Boolean(role) && detail.isPending;

  return (
    <FormSheetShell
      open={Boolean(role)}
      onOpenChange={close}
      title={t('managePermissionsTitle')}
      description={role ? `${t('managePermissionsSubtitle')} · ${role.name}` : t('managePermissionsSubtitle')}
    >
      {role ? (
        loading ? (
          <div role="status" aria-live="polite">
            <span className="sr-only">{tc('loading')}</span>
            <div
              className="h-56 animate-pulse rounded-panel border border-border bg-muted"
              aria-hidden="true"
            />
          </div>
        ) : detail.isError ? (
          <Alert variant="error" messages={[t('loadRoleFailed')]} />
        ) : (
          <FormBody onSubmit={handleSubmit}>
            <PermissionPicker
              selectedIds={permissionIds}
              onChange={setPermissionIds}
              disabled={setPermissions.isPending}
            />

            {setPermissions.error ? (
              <Alert
                variant="error"
                messages={[apiMessage(setPermissions.error, t('managePermissionsFailed'))!]}
              />
            ) : null}

            <FormFooter
              onCancel={() => close(false)}
              cancelLabel={tc('cancel')}
              submitLabel={tc('save')}
              pendingLabel={t('savePending')}
              pending={setPermissions.isPending}
            />
          </FormBody>
        )
      ) : null}
    </FormSheetShell>
  );
}
