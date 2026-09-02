'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, CheckboxField } from '@erp/ui';

import { useRoles } from '@/features/roles/hooks/use-roles';

interface RoleMultiSelectProps {
  /** Currently-selected role ids. */
  selectedIds: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

/**
 * Checkbox list of the organisation's roles, keyed by role id.
 *
 * Used by both Create User and Manage Roles. A native checkbox list rather than a custom
 * listbox — role counts here are small and bounded, and a checkbox group is keyboard- and
 * screen-reader-correct without reimplementation.
 */
export function RoleMultiSelect({ selectedIds, onChange, disabled }: RoleMultiSelectProps) {
  const t = useTranslations('platform.users.roles');
  const tCommon = useTranslations('common');
  const { data, isPending, isError } = useRoles();

  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  function toggle(id: string) {
    if (disabled) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  }

  if (isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
        <div
          className="h-32 animate-pulse rounded-panel border border-border bg-muted"
          aria-hidden="true"
        />
      </div>
    );
  }

  if (isError) {
    return <Alert variant="error" messages={[t('loadFailed')]} />;
  }

  if (data.length === 0) {
    return (
      <p className="rounded-panel border border-dashed border-border bg-surface px-4 py-6 text-center text-sm text-muted-foreground">
        {t('none')}
      </p>
    );
  }

  return (
    <fieldset className="space-y-1.5">
      <legend className="sr-only">{t('legend')}</legend>
      <div className="max-h-56 space-y-1 overflow-y-auto rounded-panel border border-border bg-surface p-2">
        {data.map((role) => (
          <CheckboxField
            key={role.id}
            id={`role-${role.id}`}
            label={role.name}
            description={role.description}
            checked={selected.has(role.id)}
            onChange={() => toggle(role.id)}
            disabled={disabled}
            className="rounded-control px-2 hover:bg-surface-hover"
          />
        ))}
      </div>
    </fieldset>
  );
}
