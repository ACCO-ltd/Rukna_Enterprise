'use client';

import { useId, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, FormDialogClose, FormField, Input, SwitchField } from '@erp/ui';

import type { UserWithRolesResponse } from '@erp/types';

import {
  FormDialogActions,
  FormDialogShell,
  apiMessage,
} from '@/features/admin/components/form-dialog-shell';
import {
  useProvisionTemporaryUser,
  useRegenerateTemporaryPassword,
  useSetUserPassword,
  useSetUserRoles,
  useUpdateUser,
} from '../hooks/use-users';
import { RoleMultiSelect } from './role-multi-select';

const MIN_PASSWORD_LENGTH = 12;

/**
 * A plain shape check — something@something.tld, no spaces. FormDialog's form is `noValidate`, so
 * the browser's own `type="email"` check no longer runs; the server remains the authority.
 */
export const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A staff WhatsApp number as the API stores it (E.164: `+` then 8–15 digits), after dropping the
 * spaces, dashes and brackets people type. A shape check only — the server validates the number.
 */
export const WHATSAPP_E164 = /^\+[1-9]\d{7,14}$/;

/** The typed number without separators (`+252 61 234 5678` → `+252612345678`); '' when blank. */
export function compactPhone(value: string): string {
  return value.trim().replace(/[\s\-().]/g, '');
}

/** Same members, in any order. */
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

// ─── Create ──────────────────────────────────────────────────────────────────────

interface CreatedCredentials {
  email: string;
  password: string;
  expiresAt: string;
}

export function CreateUserDialog({
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

  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [created, setCreated] = useState<CreatedCredentials | null>(null);
  const [tried, setTried] = useState(false);
  const emailValid = EMAIL_SHAPE.test(email.trim());

  function reset() {
    setTried(false);
    setEmail('');
    setFirstName('');
    setLastName('');
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
    setTried(true);
    const trimmed = {
      email: email.trim(),
      firstName: firstName.trim(),
      lastName: lastName.trim(),
    };
    if (!emailValid || !trimmed.firstName || !trimmed.lastName) return;

    create.mutate(
      { ...trimmed, roleIds },
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

  // Once created there is nothing left to lose — the credentials are the result, not an edit.
  const dirty =
    !created &&
    (email.trim() !== '' || firstName.trim() !== '' || lastName.trim() !== '' || roleIds.length > 0);

  return (
    <FormDialogShell
      open={open}
      onOpenChange={handleOpenChange}
      title={created ? t('createdTitle') : t('createTitle')}
      description={created ? undefined : t('createSubtitle')}
      dirty={dirty}
      busy={create.isPending}
      onSubmit={created ? undefined : handleSubmit}
      footer={
        created ? (
          <>
            <Button type="button" variant="ghost" onClick={reset}>
              {t('addAnother')}
            </Button>
            <Button type="button" onClick={() => handleOpenChange(false)}>
              {t('done')}
            </Button>
          </>
        ) : (
          <FormDialogActions
            cancelLabel={tc('cancel')}
            submitLabel={t('createSubmit')}
            pendingLabel={t('createPending')}
            pending={create.isPending}
          />
        )
      }
    >
      {created ? (
        <CredentialsSummary credentials={created} />
      ) : (
        <>
          <FormField
            htmlFor={ids.email}
            label={t('email')}
            required
            error={tried && !emailValid ? t('emailInvalid') : undefined}
          >
            <Input
              id={ids.email}
              name="email"
              type="email"
              required
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                disabled={create.isPending}
              />
            </FormField>
            <FormField htmlFor={ids.lastName} label={t('lastName')} required>
              <Input
                id={ids.lastName}
                name="lastName"
                required
                autoComplete="off"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
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
        </>
      )}
    </FormDialogShell>
  );
}

/** Shown after a user is created so the admin can copy the credentials to share. */
function CredentialsSummary({ credentials }: { credentials: CreatedCredentials }) {
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
    </div>
  );
}

// ─── Edit profile ──────────────────────────────────────────────────────────────

export function EditUserDialog({
  user,
  onOpenChange,
}: {
  user: UserWithRolesResponse | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('platform.users.form');
  const tc = useTranslations('common');
  const update = useUpdateUser();
  const ids = { firstName: useId(), lastName: useId(), whatsappPhone: useId(), whatsappAlerts: useId() };

  // Seed from the user each time a different user opens.
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [whatsappPhone, setWhatsappPhone] = useState('');
  const [whatsappAlerts, setWhatsappAlerts] = useState(false);
  const [tried, setTried] = useState(false);
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (user && seededFor !== user.id) {
    setSeededFor(user.id);
    setFirstName(user.firstName);
    setLastName(user.lastName);
    setWhatsappPhone(user.whatsappPhone ?? '');
    setWhatsappAlerts(user.whatsappAlertsEnabled ?? false);
    setTried(false);
  }

  const phone = compactPhone(whatsappPhone);
  const phoneValid = phone === '' || WHATSAPP_E164.test(phone);
  // Alerts need a number: with the number cleared the switch is off and disabled.
  const alertsOn = phone !== '' && whatsappAlerts;

  function close(next: boolean) {
    if (!next) {
      setSeededFor(null);
      update.reset();
    }
    onOpenChange(next);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    setTried(true);
    const first = firstName.trim();
    const last = lastName.trim();
    if (!first || !last || !phoneValid) return;

    const nextPhone = phone === '' ? null : phone;
    const whatsappChanged =
      nextPhone !== (user.whatsappPhone ?? null) || alertsOn !== (user.whatsappAlertsEnabled ?? false);
    update.mutate(
      {
        id: user.id,
        payload: {
          firstName: first,
          lastName: last,
          ...(whatsappChanged ? { whatsappPhone: nextPhone, whatsappAlertsEnabled: alertsOn } : {}),
        },
      },
      { onSuccess: () => close(false) },
    );
  }

  const dirty =
    Boolean(user) &&
    (firstName !== user?.firstName ||
      lastName !== user?.lastName ||
      whatsappPhone !== (user?.whatsappPhone ?? '') ||
      alertsOn !== (user?.whatsappAlertsEnabled ?? false));

  return (
    <FormDialogShell
      open={Boolean(user)}
      onOpenChange={close}
      title={t('editTitle')}
      description={user ? `${t('editSubtitle')} · ${user.email}` : t('editSubtitle')}
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
      {user ? (
        <>
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField htmlFor={ids.firstName} label={t('firstName')} required>
              <Input
                id={ids.firstName}
                name="firstName"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                autoComplete="off"
                disabled={update.isPending}
              />
            </FormField>
            <FormField htmlFor={ids.lastName} label={t('lastName')} required>
              <Input
                id={ids.lastName}
                name="lastName"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
                autoComplete="off"
                disabled={update.isPending}
              />
            </FormField>
          </div>

          <FormField
            htmlFor={ids.whatsappPhone}
            label={t('whatsappPhone')}
            hint={t('whatsappPhoneHint')}
            error={tried && !phoneValid ? t('whatsappPhoneInvalid') : undefined}
          >
            <Input
              id={ids.whatsappPhone}
              name="whatsappPhone"
              type="tel"
              inputMode="tel"
              placeholder="+252 61 234 5678"
              value={whatsappPhone}
              onChange={(e) => setWhatsappPhone(e.target.value)}
              autoComplete="off"
              disabled={update.isPending}
            />
          </FormField>

          <SwitchField
            id={ids.whatsappAlerts}
            label={t('whatsappAlerts')}
            description={phone === '' ? t('whatsappAlertsNeedsNumber') : t('whatsappAlertsHint')}
            checked={alertsOn}
            onCheckedChange={setWhatsappAlerts}
            disabled={update.isPending || phone === ''}
          />

          {update.error ? (
            <Alert variant="error" messages={[apiMessage(update.error, t('editFailed'))!]} />
          ) : null}
        </>
      ) : null}
    </FormDialogShell>
  );
}

// ─── Set password ────────────────────────────────────────────────────────────────

export function SetPasswordDialog({
  user,
  onOpenChange,
}: {
  user: UserWithRolesResponse | null;
  onOpenChange: (open: boolean) => void;
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
          close(false);
        },
      },
    );
  }

  return (
    <FormDialogShell
      open={Boolean(user)}
      onOpenChange={close}
      title={t('setPasswordTitle')}
      description={
        user ? `${t('setPasswordSubtitle')} · ${user.firstName} ${user.lastName}` : t('setPasswordSubtitle')
      }
      dirty={password.length > 0}
      busy={setPassword.isPending}
      onSubmit={handleSubmit}
      footer={
        <FormDialogActions
          cancelLabel={tc('cancel')}
          submitLabel={t('setPasswordSubmit')}
          pendingLabel={t('setPasswordPending')}
          pending={setPassword.isPending}
          disabled={password.length < MIN_PASSWORD_LENGTH}
        />
      }
    >
      {user ? (
        <>
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
        </>
      ) : null}
    </FormDialogShell>
  );
}

// ─── Regenerate temporary password ────────────────────────────────────────────────

export function RegenerateTemporaryDialog({
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
    <FormDialogShell
      open={Boolean(user)}
      onOpenChange={close}
      title={t('regenerateTitle')}
      description={
        user ? `${t('regenerateHint')} · ${user.firstName} ${user.lastName}` : t('regenerateHint')
      }
      busy={regenerate.isPending}
      footer={
        regenerate.data ? (
          <Button type="button" onClick={() => close(false)}>
            {t('done')}
          </Button>
        ) : (
          <>
            <FormDialogClose asChild>
              <Button type="button" variant="outline" disabled={regenerate.isPending}>
                {tc('cancel')}
              </Button>
            </FormDialogClose>
            <Button
              type="button"
              onClick={() => user && regenerate.mutate(user.id)}
              disabled={!user}
              loading={regenerate.isPending}
              loadingText={t('regenerating')}
            >
              {t('regenerateSubmit')}
            </Button>
          </>
        )
      }
    >
      {user ? (
        regenerate.data ? (
          <>
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
          </>
        ) : (
          <>
            <Alert variant="warning" messages={[t('regenerateWarning')]} />

            {regenerate.error ? (
              <Alert
                variant="error"
                messages={[apiMessage(regenerate.error, t('regenerateWarning'))!]}
              />
            ) : null}
          </>
        )
      ) : null}
    </FormDialogShell>
  );
}

// ─── Manage roles ────────────────────────────────────────────────────────────────

export function ManageRolesDialog({
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

  const dirty = Boolean(user) && !sameSet(roleIds, user?.roles.map((r) => r.id) ?? []);

  return (
    <FormDialogShell
      open={Boolean(user)}
      onOpenChange={close}
      title={t('manageRolesTitle')}
      description={
        user ? `${t('manageRolesSubtitle')} · ${user.firstName} ${user.lastName}` : t('manageRolesSubtitle')
      }
      dirty={dirty}
      busy={setRoles.isPending}
      onSubmit={handleSubmit}
      footer={
        <FormDialogActions
          cancelLabel={tc('cancel')}
          submitLabel={tc('save')}
          pendingLabel={t('savePending')}
          pending={setRoles.isPending}
        />
      }
    >
      {user ? (
        <>
          <RoleMultiSelect
            selectedIds={roleIds}
            onChange={setRoleIds}
            disabled={setRoles.isPending}
          />

          {setRoles.error ? (
            <Alert variant="error" messages={[apiMessage(setRoles.error, t('manageRolesFailed'))!]} />
          ) : null}
        </>
      ) : null}
    </FormDialogShell>
  );
}
