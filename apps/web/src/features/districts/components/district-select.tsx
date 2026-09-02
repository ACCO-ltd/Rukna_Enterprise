'use client';

import { useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  Combobox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  FormField,
  Input,
} from '@erp/ui';

import { usePermissions } from '@/features/auth/permissions/can';
import { ApiError } from '@/lib/api-client';

import type { District } from '../api/districts-api';
import { useCreateDistrict, useDistricts } from '../hooks/use-districts';
import { suggestDistrictCode } from '../suggest-district-code';

/**
 * The district picker, with the registry's own escape hatch built in.
 *
 * ─── Why the create action is a dialog and not an inline panel ───────────────────
 *
 * The first version put a code/name panel underneath the field. It worked, but it grew the
 * form by ~140px at the exact moment the user was mid-answer, pushing every field below it
 * down the page — and it was visible whether or not anyone needed it. As the last row of the
 * list, "Add a district" costs nothing until someone has scanned the options and concluded
 * theirs is missing, which is the only moment it is wanted. The dialog then holds the two
 * fields without moving anything behind it.
 *
 * ─── Why code and name, and not free text ────────────────────────────────────────
 *
 * A district's `code` becomes a permanent segment of every project code issued in it
 * (ADR-025: `ACCO-WBR-26-0065`), unique per organization, immutable after creation, and
 * `onDelete: Restrict`. A combobox you can type a new value into would let two people invent
 * `WDJ` and `WADAJIR` for one area and split the registry permanently, with the projects
 * already numbered under each unfixable. So creation asks for both fields explicitly — the
 * same two the Settings screen asks for — and only from someone holding `manage:district`,
 * which is what `POST /districts` enforces anyway.
 */
export function DistrictSelect({
  id,
  value,
  onChange,
  invalid,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (districtId: string) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const t = useTranslations('platform.districts');
  const tCommon = useTranslations('common');
  const { can } = usePermissions();
  const canManage = can('manage:district');

  const { data: districts = [] } = useDistricts(true);
  const [creating, setCreating] = useState(false);

  const options = districts.map((district) => ({
    value: district.id,
    label: district.name,
    hint: district.code,
  }));

  return (
    <>
      <Combobox
        id={id}
        value={value}
        onChange={onChange}
        options={options}
        placeholder={t('pickerPlaceholder')}
        searchPlaceholder={tCommon('search')}
        // An empty registry is not the same as a filter that matched nothing, and someone who
        // cannot fix it needs to be told who can.
        emptyLabel={
          districts.length === 0 && !canManage ? t('pickerEmptyRestricted') : t('pickerNoMatch')
        }
        footerAction={canManage ? { label: t('addTitle'), onSelect: () => setCreating(true) } : undefined}
        invalid={invalid}
        aria-describedby={describedBy}
        aria-required
      />

      {creating ? (
        <CreateDistrictDialog
          existing={districts}
          onCreated={(district) => {
            // Selecting it is the confirmation. Creating a district and then leaving the
            // picker empty would make the user answer the same question twice.
            onChange(district.id);
            setCreating(false);
          }}
          onDismiss={() => setCreating(false)}
        />
      ) : null}
    </>
  );
}

// ─── Create dialog ────────────────────────────────────────────────────────────

/**
 * Name first, code second — and the code arrives already filled in.
 *
 * The original order asked for the code before the name, which is the harder question asked
 * first with nothing to answer it from. Reversing them means the code can be *derived* from
 * what was just typed, so the field someone stalled on becomes one they only have to approve.
 * It stays fully editable: `suggestDistrictCode` documents why no rule recovers every code
 * the registry already holds.
 */
function CreateDistrictDialog({
  existing,
  onCreated,
  onDismiss,
}: {
  existing: readonly District[];
  onCreated: (district: District) => void;
  onDismiss: () => void;
}) {
  const t = useTranslations('platform.districts');
  const tCommon = useTranslations('common');
  const nameRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [typedCode, setTypedCode] = useState('');
  const [codeEdited, setCodeEdited] = useState(false);
  const create = useCreateDistrict();

  const takenCodes = useMemo(
    () => existing.map((district) => district.code.toUpperCase()),
    [existing],
  );

  // Until the user touches the code field it tracks the name. After that it is theirs, and a
  // later edit to the name must not overwrite what they chose.
  const code = codeEdited ? typedCode : suggestDistrictCode(name, takenCodes);
  const isDuplicate = code.length > 0 && takenCodes.includes(code.toUpperCase());

  const canSubmit =
    code.trim().length > 0 && name.trim().length > 0 && !isDuplicate && !create.isPending;

  const requestError = create.isError
    ? create.error instanceof ApiError
      ? create.error.message
      : t('createFailed')
    : null;

  const submit = () => {
    if (!canSubmit) return;
    create.mutate({ code: code.trim().toUpperCase(), name: name.trim() }, { onSuccess: onCreated });
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !create.isPending) onDismiss();
      }}
    >
      <DialogContent
        closeLabel={tCommon('close')}
        className="sm:max-w-lg"
        onEscapeKeyDown={(event) => {
          if (create.isPending) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (create.isPending) event.preventDefault();
        }}
        onOpenAutoFocus={(event) => {
          // Radix focuses the first focusable node, which here is the close control. The
          // point of this dialog is the name field — and the code follows from it.
          event.preventDefault();
          nameRef.current?.focus();
        }}
      >
        <DialogTitle>{t('addTitle')}</DialogTitle>
        <DialogDescription>{t('intro')}</DialogDescription>

        {requestError ? (
          <div className="mt-4">
            <Alert variant="error" messages={[requestError]} />
          </div>
        ) : null}

        <div
          className="mt-5 space-y-4"
          // Enter should add the district, not fall through to whatever form opened the
          // dialog — on the project screen that form creates the project.
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            submit();
          }}
        >
          <FormField htmlFor="district-new-name" label={t('nameLabel')} hint={t('nameHint')} required>
            <Input
              id="district-new-name"
              ref={nameRef}
              value={name}
              autoComplete="off"
              onChange={(event) => setName(event.target.value)}
            />
          </FormField>

          <FormField
            htmlFor="district-new-code"
            label={t('codeLabel')}
            hint={codeEdited ? t('codeHint') : t('codeSuggested')}
            error={isDuplicate ? t('codeDuplicate') : undefined}
            className="max-w-40"
            required
          >
            <Input
              id="district-new-code"
              value={code}
              maxLength={8}
              autoComplete="off"
              className="font-mono text-h3"
              onChange={(event) => {
                setCodeEdited(true);
                setTypedCode(event.target.value.toUpperCase());
              }}
            />
          </FormField>
        </div>

        <DialogFooter>
          <Button type="button" onClick={submit} disabled={!canSubmit}>
            {create.isPending ? tCommon('formActions.pendingLabel') : t('add')}
          </Button>
          <Button type="button" variant="outline" onClick={onDismiss} disabled={create.isPending}>
            {tCommon('cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
