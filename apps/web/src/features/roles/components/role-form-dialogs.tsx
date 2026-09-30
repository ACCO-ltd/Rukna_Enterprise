'use client';

import { useId, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, FormField, Input, Select, Textarea } from '@erp/ui';

import type { RoleSummary } from '@erp/types';
import { PermissionPicker } from '@/features/permissions/components/permission-picker';
import {
  FormDialogActions,
  FormDialogShell,
  apiMessage,
} from '@/features/admin/components/form-dialog-shell';

import {
  useCreateRole,
  useRole,
  useRoles,
  useSetRolePermissions,
  useUpdateRole,
} from '../hooks/use-roles';

/** Same members, in any order. */
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

// ─── Create ──────────────────────────────────────────────────────────────────────

const EMPTY_ROLE = { name: '', purpose: '', templateRoleId: '', description: '' };

/** `lg` (ADR-039): a record form carrying the whole permission picker. */
export function CreateRoleDialog({
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
  const [fields, setFields] = useState(EMPTY_ROLE);
  const [permissionIds, setPermissionIds] = useState<string[]>([]);

  const patch = (next: Partial<typeof EMPTY_ROLE>) => setFields((prev) => ({ ...prev, ...next }));

  function close(next: boolean) {
    if (!next) {
      setFields(EMPTY_ROLE);
      setPermissionIds([]);
      create.reset();
    }
    onOpenChange(next);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = fields.name.trim();
    const purpose = fields.purpose.trim();
    const templateRoleId = fields.templateRoleId;
    const description = fields.description.trim();
    if (!name || !purpose) return;

    create.mutate(
      {
        name,
        purpose,
        ...(templateRoleId ? { templateRoleId } : {}),
        ...(description ? { description } : {}),
        ...(permissionIds.length > 0 ? { permissionIds } : {}),
      },
      { onSuccess: () => close(false) },
    );
  }

  const dirty =
    Object.values(fields).some((value) => value.trim() !== '') || permissionIds.length > 0;

  return (
    <FormDialogShell
      open={open}
      onOpenChange={close}
      title={t('createTitle')}
      description={t('createSubtitle')}
      size="lg"
      dirty={dirty}
      busy={create.isPending}
      onSubmit={handleSubmit}
      footer={
        <FormDialogActions
          cancelLabel={tc('cancel')}
          submitLabel={t('createSubmit')}
          pendingLabel={t('createPending')}
          pending={create.isPending}
        />
      }
    >
      <FormField htmlFor={ids.name} label={t('name')} required>
        <Input
          id={ids.name}
          name="name"
          required
          maxLength={100}
          autoComplete="off"
          value={fields.name}
          onChange={(e) => patch({ name: e.target.value })}
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
          value={fields.purpose}
          onChange={(e) => patch({ purpose: e.target.value })}
          disabled={create.isPending}
        />
      </FormField>

      <FormField htmlFor={ids.template} label={t('template')}>
        <Select
          id={ids.template}
          name="templateRoleId"
          value={fields.templateRoleId}
          onChange={(value) => patch({ templateRoleId: value })}
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
          value={fields.description}
          onChange={(e) => patch({ description: e.target.value })}
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
    </FormDialogShell>
  );
}

// ─── Edit ────────────────────────────────────────────────────────────────────────

export function EditRoleDialog({
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

  // Seed from the role each time a different role opens.
  const [fields, setFields] = useState({ name: '', purpose: '', description: '' });
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (role && seededFor !== role.id) {
    setSeededFor(role.id);
    setFields({
      name: role.name,
      purpose: role.purpose ?? '',
      description: role.description ?? '',
    });
  }

  const patch = (next: Partial<typeof fields>) => setFields((prev) => ({ ...prev, ...next }));

  function close(next: boolean) {
    if (!next) {
      setSeededFor(null);
      update.reset();
    }
    onOpenChange(next);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!role) return;
    const name = fields.name.trim();
    const purpose = fields.purpose.trim();
    const description = fields.description.trim();
    if (!name || !purpose) return;

    update.mutate(
      { id: role.id, payload: { name, purpose, description } },
      { onSuccess: () => close(false) },
    );
  }

  const dirty =
    Boolean(role) &&
    (fields.name !== role?.name ||
      fields.purpose !== (role?.purpose ?? '') ||
      fields.description !== (role?.description ?? ''));

  return (
    <FormDialogShell
      open={Boolean(role)}
      onOpenChange={close}
      title={t('editTitle')}
      description={role ? `${t('editSubtitle')} · ${role.name}` : t('editSubtitle')}
      dirty={dirty}
      busy={update.isPending}
      onSubmit={handleSubmit}
      footer={
        <FormDialogActions
          cancelLabel={tc('cancel')}
          submitLabel={tc('save')}
          pendingLabel={t('savePending')}
          pending={update.isPending}
        />
      }
    >
      {role ? (
        <>
          <FormField htmlFor={ids.name} label={t('name')} required>
            <Input
              id={ids.name}
              name="name"
              value={fields.name}
              onChange={(e) => patch({ name: e.target.value })}
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
              value={fields.purpose}
              onChange={(e) => patch({ purpose: e.target.value })}
              disabled={update.isPending}
            />
          </FormField>

          <FormField htmlFor={ids.description} label={`${t('description')} (${tc('optional')})`}>
            <Textarea
              id={ids.description}
              name="description"
              rows={2}
              maxLength={500}
              value={fields.description}
              onChange={(e) => patch({ description: e.target.value })}
              disabled={update.isPending}
            />
          </FormField>

          {update.error ? (
            <Alert variant="error" messages={[apiMessage(update.error, t('editFailed'))!]} />
          ) : null}
        </>
      ) : null}
    </FormDialogShell>
  );
}

// ─── Manage permissions ──────────────────────────────────────────────────────────

/** `lg` (ADR-039): the permission picker is a long list. */
export function ManagePermissionsDialog({
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
  const ready = Boolean(role) && !loading && !detail.isError;
  const dirty =
    ready &&
    seededFor === role?.id &&
    !sameSet(permissionIds, detail.data?.permissions.map((p) => p.id) ?? []);

  return (
    <FormDialogShell
      open={Boolean(role)}
      onOpenChange={close}
      title={t('managePermissionsTitle')}
      description={role ? `${t('managePermissionsSubtitle')} · ${role.name}` : t('managePermissionsSubtitle')}
      size="lg"
      dirty={dirty}
      busy={setPermissions.isPending}
      onSubmit={ready ? handleSubmit : undefined}
      footer={
        <FormDialogActions
          cancelLabel={tc('cancel')}
          submitLabel={tc('save')}
          pendingLabel={t('savePending')}
          pending={setPermissions.isPending}
          disabled={!ready}
        />
      }
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
          <>
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
          </>
        )
      ) : null}
    </FormDialogShell>
  );
}
