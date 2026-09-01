'use client';

import { useId, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, FormField, Input } from '@erp/ui';

import type { UserWithRolesResponse } from '@erp/types';

import {
  FormBody,
  FormFooter,
  FormSheetShell,
  apiMessage,
} from '@/features/admin/components/form-sheet-shell';
import {
  useProvisionTemporaryUser,
  useRegenerateTemporaryPassword,
  useSetUserPassword,
  useSetUserRoles,
  useUpdateUser,
} from '../hooks/use-users';
import { RoleMultiSelect } from './role-multi-select';

const MIN_PASSWORD_LENGTH = 12;

// ─── Create ──────────────────────────────────────────────────────────────────────

interface CreatedCredentials {
  email: string;
  password: string;
  expiresAt: string;
}

export function CreateUserSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('platform.users.form');
  const tc = useTranslations('common');
  const create = useProvisionTemporaryUser();

  const ids = {
    email: useId(),
    firstName: useId(),
    lastName: useId(),
  };

  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [created, setCreated] = useState<CreatedCredentials | null>(null);

  function reset() {
    setRoleIds([]);
    setCreated(null);
    create.reset();
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '').trim();
    const firstName = String(form.get('firstName') ?? '').trim();
    const lastName = String(form.get('lastName') ?? '').trim();

    if (!email || !firstName || !lastName) return;

    create.mutate(
      { email, firstName, lastName, roleIds },
      {
        onSuccess: (result) => {
          setCreated({
            email: result.user.email,
            password: result.temporaryPassword,
            expiresAt: result.expiresAt,
          });
        },
      },
    );
  }

  const title = created ? t('createdTitle') : t('createTitle');

  return (
    <FormSheetShell
      open={open}
      onOpenChange={handleOpenChange}
      title={title}
      description={created ? undefined : t('createSubtitle')}
    >
      {created ? (
        <CredentialsSummary
          credentials={created}
          onDone={() => handleOpenChange(false)}
          onAddAnother={reset}
        />
      ) : (
        <FormBody onSubmit={handleSubmit}>
          <FormField htmlFor={ids.email} label={t('email')} required>
            <Input
              id={ids.email}
              name="email"
              type="email"
              required
              autoComplete="off"
              disabled={create.isPending}
            />
          </FormField>

          <div className="grid gap-5 sm:grid-cols-2">
            <FormField htmlFor={ids.firstName} label={t('firstName')} required>
              <Input
                id={ids.firstName}
                name="firstName"
                required
                autoComplete="off"
                disabled={create.isPending}
              />
            </FormField>
            <FormField htmlFor={ids.lastName} label={t('lastName')} required>
              <Input
                id={ids.lastName}
                name="lastName"
                required
                autoComplete="off"
                disabled={create.isPending}
              />
            </FormField>
          </div>

          <div>
            <p className="mb-1.5 text-sm font-medium text-foreground">{t('roles')}</p>
            <RoleMultiSelect
              selectedIds={roleIds}
              onChange={setRoleIds}
              disabled={create.isPending}
            />
          </div>

          {create.error ? (
            <Alert variant="error" messages={[apiMessage(create.error, t('createFailed'))!]} />
          ) : null}

          <FormFooter
            onCancel={() => handleOpenChange(false)}
            cancelLabel={tc('cancel')}
            submitLabel={t('createSubmit')}
            pendingLabel={t('createPending')}
            pending={create.isPending}
          />
        </FormBody>
      )}
    </FormSheetShell>
  );
}

/** Shown after a user is created so the admin can copy the credentials to share. */
function CredentialsSummary({
  credentials,
  onDone,
  onAddAnother,
}: {
  credentials: CreatedCredentials;
  onDone: () => void;
  onAddAnother: () => void;
}) {
  const t = useTranslations('platform.users.form');
  const [copied, setCopied] = useState(false);

  async function copy() {
    const text = `${t('email')}: ${credentials.email}\n${t('tempPassword')}: ${credentials.password}\n${t('expiresAt')}: ${new Date(credentials.expiresAt).toLocaleString()}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be unavailable (insecure context / denied permission). The values are
      // shown on screen regardless, so failing to copy is not a dead end.
      setCopied(false);
    }
  }

  return (
    <div className="space-y-4">
      <Alert variant="success" messages={[t('createdHint')]} />

      <dl className="space-y-3 rounded-panel border border-border bg-surface p-4">
        <div>
          <dt className="text-micro font-semibold uppercase text-muted-foreground">
            {t('email')}
          </dt>
          <dd className="mt-0.5 break-all font-mono text-sm text-foreground">
            {credentials.email}
          </dd>
        </div>
        <div>
          <dt className="text-micro font-semibold uppercase text-muted-foreground">
            {t('expiresAt')}
          </dt>
          <dd className="mt-0.5 text-sm text-foreground">
            {new Date(credentials.expiresAt).toLocaleString()}
          </dd>
        </div>
        <div>
          <dt className="text-micro font-semibold uppercase text-muted-foreground">
            {t('tempPassword')}
          </dt>
          <dd className="mt-0.5 break-all font-mono text-sm text-foreground">
            {credentials.password}
          </dd>
        </div>
      </dl>

      <Button type="button" variant="outline" onClick={() => void copy()} className="w-full">
        {copied ? t('copied') : t('copyCredentials')}
      </Button>

      <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="ghost" onClick={onAddAnother}>
          {t('addAnother')}
        </Button>
        <Button type="button" onClick={onDone}>
          {t('done')}
        </Button>
      </div>
    </div>
  );
}

// ─── Edit profile ──────────────────────────────────────────────────────────────

export function EditUserSheet({
  user,
  onOpenChange,
}: {
  user: UserWithRolesResponse | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('platform.users.form');
  const tc = useTranslations('common');
  const update = useUpdateUser();
  const ids = { firstName: useId(), lastName: useId() };

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    const form = new FormData(event.currentTarget);
    const firstName = String(form.get('firstName') ?? '').trim();
    const lastName = String(form.get('lastName') ?? '').trim();
    if (!firstName || !lastName) return;

    update.mutate(
      { id: user.id, payload: { firstName, lastName } },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <FormSheetShell
      open={Boolean(user)}
      onOpenChange={(next) => {
        if (!next) update.reset();
        onOpenChange(next);
      }}
      title={t('editTitle')}
      description={user ? `${t('editSubtitle')} · ${user.email}` : t('editSubtitle')}
    >
      {user ? (
        <FormBody onSubmit={handleSubmit}>
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField htmlFor={ids.firstName} label={t('firstName')} required>
              <Input
                id={ids.firstName}
                name="firstName"
                defaultValue={user.firstName}
                required
                autoComplete="off"
                disabled={update.isPending}
              />
            </FormField>
            <FormField htmlFor={ids.lastName} label={t('lastName')} required>
              <Input
                id={ids.lastName}
                name="lastName"
                defaultValue={user.lastName}
                required
                autoComplete="off"
                disabled={update.isPending}
              />
            </FormField>
          </div>

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

// ─── Set password ────────────────────────────────────────────────────────────────

export function SetPasswordSheet({
  user,
  onOpenChange,
  onSuccess,
}: {
  user: UserWithRolesResponse | null;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const t = useTranslations('platform.users.form');
  const tc = useTranslations('common');
  const setPassword = useSetUserPassword();
  const id = useId();
  const [password, setPasswordValue] = useState('');

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;

  function close(next: boolean) {
    if (!next) {
      setPasswordValue('');
      setPassword.reset();
    }
    onOpenChange(next);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || password.length < MIN_PASSWORD_LENGTH) return;
    setPassword.mutate(
      { id: user.id, payload: { password } },
      {
        onSuccess: () => {
          setPasswordValue('');
          onSuccess();
          close(false);
        },
      },
    );
  }

  return (
    <FormSheetShell
      open={Boolean(user)}
      onOpenChange={close}
      title={t('setPasswordTitle')}
      description={
        user ? `${t('setPasswordSubtitle')} · ${user.firstName} ${user.lastName}` : t('setPasswordSubtitle')
      }
    >
      {user ? (
        <FormBody onSubmit={handleSubmit}>
          <FormField
            htmlFor={id}
            label={t('newPassword')}
            hint={t('passwordHint')}
            error={tooShort ? t('passwordTooShort', { min: MIN_PASSWORD_LENGTH }) : undefined}
            required
          >
            <Input
              id={id}
              name="password"
              type="text"
              value={password}
              onChange={(e) => setPasswordValue(e.target.value)}
              autoComplete="off"
              disabled={setPassword.isPending}
            />
          </FormField>

          {setPassword.error ? (
            <Alert
              variant="error"
              messages={[apiMessage(setPassword.error, t('setPasswordFailed'))!]}
            />
          ) : null}

          <FormFooter
            onCancel={() => close(false)}
            cancelLabel={tc('cancel')}
            submitLabel={t('setPasswordSubmit')}
            pendingLabel={t('setPasswordPending')}
            pending={setPassword.isPending}
            disabled={password.length < MIN_PASSWORD_LENGTH}
          />
        </FormBody>
      ) : null}
    </FormSheetShell>
  );
}

// ─── Regenerate temporary password ────────────────────────────────────────────────

export function RegenerateTemporarySheet({
  user,
  onOpenChange,
}: {
  user: UserWithRolesResponse | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('platform.users.form');
  const tc = useTranslations('common');
  const regenerate = useRegenerateTemporaryPassword();

  function close(next: boolean) {
    if (!next) regenerate.reset();
    onOpenChange(next);
  }

  return (
    <FormSheetShell
      open={Boolean(user)}
      onOpenChange={close}
      title={t('regenerateTitle')}
      description={
        user ? `${t('regenerateHint')} · ${user.firstName} ${user.lastName}` : t('regenerateHint')
      }
    >
      {user ? (
        regenerate.data ? (
          <div className="space-y-4">
            <Alert variant="success" messages={[t('regenerateDone')]} />
            <dl className="space-y-3 rounded-panel border border-border bg-surface p-4">
              <div>
                <dt className="text-micro font-semibold uppercase text-muted-foreground">
                  {t('tempPassword')}
                </dt>
                <dd className="mt-0.5 break-all font-mono text-sm text-foreground">
                  {regenerate.data.temporaryPassword}
                </dd>
              </div>
              <div>
                <dt className="text-micro font-semibold uppercase text-muted-foreground">
                  {t('expiresAt')}
                </dt>
                <dd className="mt-0.5 text-sm text-foreground">
                  {new Date(regenerate.data.expiresAt).toLocaleString()}
                </dd>
              </div>
            </dl>
            <div className="mt-6 flex justify-end border-t border-border pt-4">
              <Button type="button" onClick={() => close(false)}>
                {t('done')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <Alert variant="warning" messages={[t('regenerateWarning')]} />

            {regenerate.error ? (
              <Alert
                variant="error"
                messages={[apiMessage(regenerate.error, t('regenerateWarning'))!]}
              />
            ) : null}

            <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-border pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => close(false)}
                disabled={regenerate.isPending}
              >
                {tc('cancel')}
              </Button>
              <Button
                type="button"
                onClick={() => regenerate.mutate(user.id)}
                disabled={regenerate.isPending}
              >
                {regenerate.isPending ? t('regenerating') : t('regenerateSubmit')}
              </Button>
            </div>
          </div>
        )
      ) : null}
    </FormSheetShell>
  );
}

// ─── Manage roles ────────────────────────────────────────────────────────────────

export function ManageRolesSheet({
  user,
  onOpenChange,
}: {
  user: UserWithRolesResponse | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('platform.users.form');
  const tc = useTranslations('common');
  const setRoles = useSetUserRoles();

  // Seed from the user's current roles each time a different user opens.
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [seededFor, setSeededFor] = useState<string | null>(null);

  if (user && seededFor !== user.id) {
    setSeededFor(user.id);
    setRoleIds(user.roles.map((r) => r.id));
  }

  function close(next: boolean) {
    if (!next) {
      setSeededFor(null);
      setRoles.reset();
    }
    onOpenChange(next);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    setRoles.mutate({ id: user.id, payload: { roleIds } }, { onSuccess: () => close(false) });
  }

  return (
    <FormSheetShell
      open={Boolean(user)}
      onOpenChange={close}
      title={t('manageRolesTitle')}
      description={
        user ? `${t('manageRolesSubtitle')} · ${user.firstName} ${user.lastName}` : t('manageRolesSubtitle')
      }
    >
      {user ? (
        <FormBody onSubmit={handleSubmit}>
          <RoleMultiSelect
            selectedIds={roleIds}
            onChange={setRoleIds}
            disabled={setRoles.isPending}
          />

          {setRoles.error ? (
            <Alert variant="error" messages={[apiMessage(setRoles.error, t('manageRolesFailed'))!]} />
          ) : null}

          <FormFooter
            onCancel={() => close(false)}
            cancelLabel={tc('cancel')}
            submitLabel={tc('save')}
            pendingLabel={t('savePending')}
            pending={setRoles.isPending}
          />
        </FormBody>
      ) : null}
    </FormSheetShell>
  );
}
