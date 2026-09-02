'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ProjectCategory } from '@erp/types';
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

import type { ProjectSubtype } from '../api/project-subtypes-api';
import {
  useCreateProjectSubtype,
  useProjectSubtypes,
} from '../hooks/use-project-subtypes';

/**
 * The subtype picker, mirroring `DistrictSelect`: a searchable combobox of the chosen
 * category's ACTIVE subtypes with an "Add a subtype" escape hatch pinned to the last row.
 *
 * ─── How it differs from the district picker ─────────────────────────────────────
 *
 *  - **Scoped to a category.** A subtype only exists within one `ProjectCategory`, so the
 *    picker is disabled until a category is chosen and it lists only that category's subtypes.
 *    The parent form clears the selected subtype when the category changes (see project-form).
 *  - **Optional.** Leaving it blank is a valid answer, so the placeholder says "(optional)"
 *    and there is no required marker — unlike district, which forms the project code.
 *  - **Curated, no free text.** As with districts, a value cannot be typed into the combobox;
 *    a new subtype is added only through the dialog, and only by a `manage:project-type`
 *    holder — which is what `POST /project-subtypes` enforces anyway.
 */
export function ProjectSubtypeSelect({
  id,
  category,
  value,
  onChange,
  describedBy,
}: {
  id: string;
  /** The chosen category. The picker is disabled and lists nothing until this is set. */
  category: ProjectCategory | undefined;
  value: string;
  onChange: (subtypeId: string) => void;
  describedBy?: string;
}) {
  const t = useTranslations('projectTypes.select');
  const tForm = useTranslations('projectTypes.form');
  const tCommon = useTranslations('common');
  const { can } = usePermissions();
  const canManage = can('manage:project-type');

  const { data: subtypes = [] } = useProjectSubtypes(category, true);
  const [creating, setCreating] = useState(false);

  const options = subtypes.map((subtype) => ({
    value: subtype.id,
    label: subtype.name,
  }));

  return (
    <>
      <Combobox
        id={id}
        value={value}
        onChange={onChange}
        options={options}
        disabled={category === undefined}
        placeholder={
          category === undefined ? tForm('subtypePickCategoryFirst') : t('placeholder')
        }
        searchPlaceholder={tCommon('search')}
        // An empty registry (nothing set up for this category yet) is not the same as a filter
        // that matched nothing, and someone who cannot fix it needs to be told who can.
        emptyLabel={
          subtypes.length === 0 && !canManage ? t('emptyRestricted') : t('noMatch')
        }
        footerAction={
          canManage && category !== undefined
            ? { label: t('addTitle'), onSelect: () => setCreating(true) }
            : undefined
        }
        aria-describedby={describedBy}
      />

      {creating && category !== undefined ? (
        <CreateSubtypeDialog
          category={category}
          existing={subtypes}
          onCreated={(subtype) => {
            // Selecting it is the confirmation, the same as the district picker — creating a
            // subtype and leaving the picker empty would make the user answer twice.
            onChange(subtype.id);
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
 * A single name field, scoped to the current category. Simpler than the district dialog: a
 * subtype has no code (it is not part of the project code), so there is no derived-code step —
 * just the name, validated for a duplicate within the category the picker is showing.
 */
function CreateSubtypeDialog({
  category,
  existing,
  onCreated,
  onDismiss,
}: {
  category: ProjectCategory;
  existing: readonly ProjectSubtype[];
  onCreated: (subtype: ProjectSubtype) => void;
  onDismiss: () => void;
}) {
  const t = useTranslations('projectTypes.select');
  const tCommon = useTranslations('common');
  const nameRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const create = useCreateProjectSubtype();

  const trimmed = name.trim();
  const isDuplicate = existing.some(
    (subtype) => subtype.name.toLowerCase() === trimmed.toLowerCase(),
  );
  const canSubmit = trimmed.length > 0 && !isDuplicate && !create.isPending;

  const requestError = create.isError
    ? create.error instanceof ApiError
      ? create.error.message
      : t('createFailed')
    : null;

  const submit = () => {
    if (!canSubmit) return;
    create.mutate({ category, name: trimmed }, { onSuccess: onCreated });
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
          // Radix focuses the close control first; the point of this dialog is the name field.
          event.preventDefault();
          nameRef.current?.focus();
        }}
      >
        <DialogTitle>{t('addTitle')}</DialogTitle>
        <DialogDescription>{t('nameHint')}</DialogDescription>

        {requestError ? (
          <div className="mt-4">
            <Alert variant="error" messages={[requestError]} />
          </div>
        ) : null}

        <div
          className="mt-5"
          // Enter should add the subtype, not fall through to the project form behind the
          // dialog — on the project screen that form creates the project.
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            submit();
          }}
        >
          <FormField htmlFor="subtype-new-name" label={t('nameLabel')} hint={t('nameHint')} required>
            <Input
              id="subtype-new-name"
              ref={nameRef}
              value={name}
              maxLength={120}
              autoComplete="off"
              onChange={(event) => setName(event.target.value)}
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
