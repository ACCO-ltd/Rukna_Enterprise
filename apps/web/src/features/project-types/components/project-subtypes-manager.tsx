'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ProjectCategory } from '@erp/types';
import {
  Alert,
  Badge,
  Button,
  FormField,
  Input,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';

import { usePermissions } from '@/features/auth/permissions/can';
import { ApiError } from '@/lib/api-client';

import type { ProjectSubtype } from '../api/project-subtypes-api';
import {
  useCreateProjectSubtype,
  useDeactivateProjectSubtype,
  useProjectSubtypes,
} from '../hooks/use-project-subtypes';

/** The six fixed categories, in enum order, each rendered as its own registry group. */
const CATEGORIES = Object.values(ProjectCategory);

/**
 * The Settings subtype registry, mirroring `DistrictsManager`: subtypes grouped by the six
 * fixed categories, each group listing its rows (active and inactive) with an inline "Add"
 * (name only) and a "Deactivate" action. Gated by `manage:project-type`.
 */
export function ProjectSubtypesManager() {
  const t = useTranslations('projectTypes.manager');
  const { can } = usePermissions();
  const canManage = can('manage:project-type');

  return (
    <div className="space-y-8">
      <p className="text-sm text-muted-foreground">{t('intro')}</p>

      {CATEGORIES.map((category) => (
        <CategoryGroup key={category} category={category} canManage={canManage} />
      ))}
    </div>
  );
}

// ─── One category's group ───────────────────────────────────────────────────────

function CategoryGroup({
  category,
  canManage,
}: {
  category: ProjectCategory;
  canManage: boolean;
}) {
  const t = useTranslations('projectTypes.manager');
  const tCategory = useTranslations('projectTypes.categories');

  // The manager shows inactive rows too (activeOnly = false), so a deactivated subtype stays
  // visible and its history is legible — it is just marked Inactive and loses its action.
  const { data: subtypes, isPending, isError, refetch } = useProjectSubtypes(category, false);
  const create = useCreateProjectSubtype();
  const deactivate = useDeactivateProjectSubtype();

  const [name, setName] = useState('');

  const createError =
    create.error instanceof ApiError && create.error.messages.length > 0
      ? create.error.message
      : create.isError
        ? t('createFailed')
        : null;

  const trimmed = name.trim();
  const isDuplicate = (subtypes ?? []).some(
    (subtype) => subtype.name.toLowerCase() === trimmed.toLowerCase(),
  );
  const canSubmit = trimmed.length > 0 && !isDuplicate && !create.isPending;

  function onCreate() {
    if (!canSubmit) return;
    create.mutate(
      { category, name: trimmed },
      { onSuccess: () => setName('') },
    );
  }

  return (
    <section aria-labelledby={`subtype-group-${category}`} className="space-y-3">
      <h2
        id={`subtype-group-${category}`}
        className="text-base font-semibold leading-6 text-foreground"
      >
        {tCategory(category)}
      </h2>

      {canManage ? (
        <div className="rounded-panel border border-border bg-surface p-4">
          <div className="flex flex-wrap items-end gap-3">
            <FormField
              htmlFor={`subtype-name-${category}`}
              label={t('nameLabel')}
              className="min-w-52 flex-1"
            >
              <Input
                id={`subtype-name-${category}`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                placeholder={t('namePlaceholder')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onCreate();
                  }
                }}
              />
            </FormField>
            <Button type="button" onClick={onCreate} disabled={!canSubmit}>
              {create.isPending ? t('adding') : t('add')}
            </Button>
          </div>
          {createError ? <Alert variant="error" messages={[createError]} className="mt-3" /> : null}
        </div>
      ) : null}

      {isError ? (
        <Alert variant="error" messages={[t('loadFailed')]}>
          <div className="mt-3">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              {t('retry')}
            </Button>
          </div>
        </Alert>
      ) : isPending ? (
        <div
          className="h-24 animate-pulse rounded-panel border border-border bg-muted"
          aria-hidden="true"
        />
      ) : (
        <TableScroll>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('nameLabel')}</TableHead>
                <TableHead>{t('statusLabel')}</TableHead>
                {canManage ? <TableHead className="text-end">{t('actionsLabel')}</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {subtypes.length === 0 ? (
                <TableEmpty colSpan={canManage ? 3 : 2}>{t('empty')}</TableEmpty>
              ) : (
                subtypes.map((subtype) => (
                  <SubtypeRow
                    key={subtype.id}
                    subtype={subtype}
                    canManage={canManage}
                    onDeactivate={() => deactivate.mutate(subtype.id)}
                    deactivating={deactivate.isPending}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </TableScroll>
      )}
    </section>
  );
}

function SubtypeRow({
  subtype,
  canManage,
  onDeactivate,
  deactivating,
}: {
  subtype: ProjectSubtype;
  canManage: boolean;
  onDeactivate: () => void;
  deactivating: boolean;
}) {
  const t = useTranslations('projectTypes.manager');
  const isActive = subtype.status === 'ACTIVE';

  return (
    <TableRow>
      <TableCell className="text-sm text-foreground">{subtype.name}</TableCell>
      <TableCell>
        <Badge tone={isActive ? 'live' : 'neutral'}>
          {isActive ? t('active') : t('inactive')}
        </Badge>
      </TableCell>
      {canManage ? (
        <TableCell className="text-end">
          {isActive ? (
            <Button variant="outline" size="sm" disabled={deactivating} onClick={onDeactivate}>
              {t('deactivate')}
            </Button>
          ) : null}
        </TableCell>
      ) : null}
    </TableRow>
  );
}
