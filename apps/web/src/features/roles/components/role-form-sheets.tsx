'use client';

import { useId, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  FormField,
  Input,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  Select,
  Textarea,
} from '@erp/ui';

import type { RoleSummary } from '@erp/types';
import { PermissionPicker } from '@/features/permissions/components/permission-picker';
import { ApiError } from '@/lib/api-client';

import { useCreateRole, useRole, useRoles, useSetRolePermissions, useUpdateRole } from '../hooks/use-roles';

function FormSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="p-6">
        <SheetTitle className="text-lg font-semibold text-foreground">{title}</SheetTitle>
        {description ? <SheetDescription className="mt-1">{description}</SheetDescription> : null}
        <div className="mt-5">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

function apiMessage(error: unknown, fallback: string): string | undefined {
  if (error instanceof ApiError) return error.message;
  if (error) return fallback;
  return undefined;
}

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
  const ids = { name: useId(), purpose: useId(), description: useId() };
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
    <FormSheet
      open={open}
      onOpenChange={close}
      title={t('createTitle')}
      description={t('createSubtitle')}
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
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
          <Textarea id={ids.purpose} name="purpose" rows={2} required maxLength={500} disabled={create.isPending} />
        </FormField>

        <FormField htmlFor="templateRoleId" label={t('template')}>
          <Select id="templateRoleId" name="templateRoleId" disabled={create.isPending || templates.isPending}>
            <option value="">{t('noTemplate')}</option>
            {(templates.data ?? []).map((role) => <option key={role.id} value={role.id}>{role.name} ({role.kind})</option>)}
          </Select>
        </FormField>

        <FormField
          htmlFor={ids.description}
          label={`${t('description')} (${tc('optional')})`}
        >
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

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => close(false)}
            disabled={create.isPending}
          >
            {tc('cancel')}
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? tc('saving') : t('createSubmit')}
          </Button>
        </div>
      </form>
    </FormSheet>
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
    <FormSheet
      open={Boolean(role)}
      onOpenChange={(next) => {
        if (!next) update.reset();
        onOpenChange(next);
      }}
      title={t('editTitle')}
      description={role?.name}
    >
      {role ? (
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
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

          <FormField
            htmlFor={ids.description}
            label={`${t('description')} (${tc('optional')})`}
          >
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

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={update.isPending}
            >
              {tc('cancel')}
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? tc('saving') : tc('save')}
            </Button>
          </div>
        </form>
      ) : null}
    </FormSheet>
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
    <FormSheet
      open={Boolean(role)}
      onOpenChange={close}
      title={t('managePermissionsTitle')}
      description={role?.name}
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
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
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

            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => close(false)}
                disabled={setPermissions.isPending}
              >
                {tc('cancel')}
              </Button>
              <Button type="submit" disabled={setPermissions.isPending}>
                {setPermissions.isPending ? tc('saving') : tc('save')}
              </Button>
            </div>
          </form>
        )
      ) : null}
    </FormSheet>
  );
}
