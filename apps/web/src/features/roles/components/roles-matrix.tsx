'use client';

import { Fragment, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Lock } from 'lucide-react';
import { Badge, Button, cn, EmptyState, Input, Select, SkeletonTable } from '@erp/ui';
import type { RoleMatrixRole } from '@erp/types';

import { LoadError } from '@/components/load-error';
import { ListPageHeader } from '@/components/layout/list-page-header';
import { usePermissions } from '@/features/auth/permissions/can';
import { permissionKey, type PermissionCatalogueItem } from '@/features/permissions/api/permissions-api';
import { usePermissionsCatalogue } from '@/features/permissions/hooks/use-permissions-catalogue';

import { useRoleMatrix, useSaveRoleMatrix } from '../hooks/use-roles';

const ADMIN_ROLE = 'ADMIN';
const RISK_TONE = { LOW: 'neutral', MEDIUM: 'info', HIGH: 'warning', CRITICAL: 'danger' } as const;

/** System roles are reviewed, never edited here (as on the roles list); custom ones are editable. */
export const isEditableRole = (role: Pick<RoleMatrixRole, 'kind' | 'name'>) => role.kind === 'CUSTOM' && role.name !== ADMIN_ROLE;

/** Each changed role's new permission set; roles left as they were are not sent. */
export function matrixChanges(
  roles: readonly RoleMatrixRole[],
  draft: ReadonlyMap<string, ReadonlySet<string>>,
): Array<{ roleId: string; permissionIds: string[] }> {
  const changes: Array<{ roleId: string; permissionIds: string[] }> = [];
  for (const role of roles) {
    const next = draft.get(role.id);
    if (!next) continue;
    const before = new Set(role.permissionIds);
    const same = before.size === next.size && [...next].every((id) => before.has(id));
    if (!same) changes.push({ roleId: role.id, permissionIds: [...next].sort() });
  }
  return changes;
}

/**
 * Step 3 — Administration → Roles → Matrix: every permission against every role on one screen, so
 * "who can approve journals?" is one look, not a dialog per role. Rows are grouped by area with
 * their risk class; a custom role's cells toggle (with `manage:role`) and are saved together.
 */
export function RolesMatrix() {
  const t = useTranslations('platform.roles.matrix');
  const { can } = usePermissions();
  const mayManage = can('manage:role');
  const matrix = useRoleMatrix();
  const catalogue = usePermissionsCatalogue();
  const save = useSaveRoleMatrix();

  const [query, setQuery] = useState('');
  const [domain, setDomain] = useState('');
  const [draft, setDraft] = useState<Map<string, Set<string>>>(new Map());

  const roles = useMemo(() => matrix.data?.roles ?? [], [matrix.data]);
  const domains = useMemo(() => [...new Set((catalogue.data ?? []).map((p) => p.domain))].sort(), [catalogue.data]);
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = (catalogue.data ?? []).filter(
      (p) =>
        (!domain || p.domain === domain) &&
        (!q || `${permissionKey(p)} ${p.description ?? ''}`.toLowerCase().includes(q)),
    );
    const byDomain = new Map<string, PermissionCatalogueItem[]>();
    for (const p of rows) byDomain.set(p.domain, [...(byDomain.get(p.domain) ?? []), p]);
    return [...byDomain.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [catalogue.data, query, domain]);

  const granted = (role: RoleMatrixRole, permissionId: string) =>
    (draft.get(role.id) ?? new Set(role.permissionIds)).has(permissionId);
  const toggle = (role: RoleMatrixRole, permissionId: string) =>
    setDraft((current) => {
      const next = new Map(current);
      const set = new Set(next.get(role.id) ?? role.permissionIds);
      if (set.has(permissionId)) set.delete(permissionId);
      else set.add(permissionId);
      next.set(role.id, set);
      return next;
    });
  const changes = matrixChanges(roles, draft);

  if (matrix.isError || catalogue.isError) {
    return (
      <LoadError
        message={t('loadFailed')}
        onRetry={() => {
          void matrix.refetch();
          void catalogue.refetch();
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <ListPageHeader
        title={t('title')}
        summary={matrix.data && catalogue.data ? t('summary', { roles: roles.length, permissions: catalogue.data.length }) : undefined}
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-72 max-w-full">
          <Input type="search" aria-label={t('search')} placeholder={t('search')} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="w-56">
          <Select id="matrix-domain" aria-label={t('area')} value={domain} onChange={setDomain}>
            <option value="">{t('allAreas')}</option>
            {domains.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </div>
        <p className="text-caption text-muted-foreground">{mayManage ? t('hintEdit') : t('hintRead')}</p>
      </div>

      {matrix.isPending || catalogue.isPending ? (
        <SkeletonTable label={t('title')} columns={6} rows={10} />
      ) : groups.length === 0 ? (
        <EmptyState title={t('noMatches')} description={t('noMatchesHint')} />
      ) : (
        <div className="relative max-h-[70vh] overflow-auto rounded-panel border border-border bg-surface">
          <table className="w-max min-w-full border-separate border-spacing-0 text-body-sm">
            <caption className="sr-only">{t('title')}</caption>
            <thead>
              <tr>
                <th scope="col" className="sticky start-0 top-0 z-30 min-w-72 border-b border-border bg-surface-subtle px-3 py-2 text-start text-caption font-semibold text-muted-foreground">
                  {t('colPermission')}
                </th>
                {roles.map((role) => (
                  <th key={role.id} scope="col" className="sticky top-0 z-20 w-28 min-w-28 border-b border-s border-border bg-surface-subtle px-2 py-2 text-center align-bottom text-caption font-semibold text-foreground">
                    <span className="block break-words">{role.name}</span>
                    <span className="mt-0.5 flex items-center justify-center gap-1 font-normal text-muted-foreground">
                      {isEditableRole(role) ? null : <Lock size={12} aria-label={t('locked')} />}
                      {t('members', { count: role.memberCount })}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map(([area, permissions]) => (
                <Fragment key={area}>
                  <tr>
                    <th colSpan={roles.length + 1} scope="colgroup" className="sticky start-0 border-b border-border bg-surface px-3 pb-1 pt-4 text-start text-micro font-semibold uppercase tracking-wider text-muted-foreground">
                      {area}
                    </th>
                  </tr>
                  {permissions.map((p) => (
                    <tr key={p.id} className="hover:bg-surface-hover">
                      <th scope="row" className="sticky start-0 z-10 border-b border-border bg-surface px-3 py-2 text-start font-normal">
                        <span className="flex items-center gap-2">
                          <code className="font-mono text-caption text-foreground">{permissionKey(p)}</code>
                          {p.riskClass === 'HIGH' || p.riskClass === 'CRITICAL' ? (
                            <Badge tone={RISK_TONE[p.riskClass]}>{t(`risk.${p.riskClass}`)}</Badge>
                          ) : null}
                        </span>
                        {p.description ? <span className="block max-w-md text-caption text-muted-foreground">{p.description}</span> : null}
                      </th>
                      {roles.map((role) => {
                        const on = granted(role, p.id);
                        const editable = mayManage && isEditableRole(role);
                        const label = t(on ? 'cellOn' : 'cellOff', { role: role.name, permission: permissionKey(p) });
                        return (
                          <td key={role.id} className="border-b border-s border-border p-0 text-center">
                            {editable ? (
                              <label className="flex h-11 cursor-pointer items-center justify-center">
                                <input
                                  type="checkbox"
                                  aria-label={label}
                                  checked={on}
                                  disabled={save.isPending}
                                  onChange={() => toggle(role, p.id)}
                                  className="size-4 accent-[var(--brand-primary)]"
                                />
                              </label>
                            ) : (
                              <span className={cn('flex h-11 items-center justify-center', on ? 'text-brand-primary' : 'text-muted-foreground')}>
                                {on ? <Check size={16} aria-label={label} /> : <span aria-label={label}>·</span>}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {changes.length > 0 ? (
        <div className="sticky bottom-4 z-30 flex flex-wrap items-center justify-between gap-3 rounded-panel border border-border bg-surface px-4 py-3 shadow-e3" role="region" aria-label={t('changesLabel')}>
          <p className="text-body-sm text-foreground">{t('changes', { count: changes.length })}</p>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" disabled={save.isPending} onClick={() => setDraft(new Map())}>
              {t('discard')}
            </Button>
            <Button type="button" loading={save.isPending} loadingText={t('saving')} onClick={() => save.mutate(changes, { onSuccess: () => setDraft(new Map()) })}>
              {t('save')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
