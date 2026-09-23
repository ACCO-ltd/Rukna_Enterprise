'use client';

import { useId, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Badge,
  Button,
  FormField,
  Input,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  FilterBar,
  FilterField,
  Select,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  Textarea,
} from '@erp/ui';

import { usePermissions } from '@/features/auth/permissions/can';
import { AdminPanel } from '@/features/admin/components/admin-panel';
import { useApprovalPolicies, useCreateApprovalPolicyDraft } from '../hooks/use-approval-policies';
import { filterPolicies, type PolicyStatusFilter } from '../filter-policies';
import { PolicyVersionComparisonSheet } from './policy-version-comparison-sheet';

/**
 * Approval policy inventory (S2) — the spine of the workflows page. The list is the primary
 * surface: a row **navigates** to the governance workspace at `/admin/workflows/[policyId]`
 * instead of opening the retired builder sheet, so the builder is deep-linkable,
 * back-button-correct and shareable. Clone and the full lifecycle moved onto the workspace;
 * only Compare stays here as a quick row action.
 *
 * Client-side search (by `policyKey`) and a status filter narrow the fetched list in memory,
 * matching the fetch-everything read model — mirroring Users and Roles. A no-match `TableEmpty`
 * is distinct from the dashed "no policies yet" empty so the two states never read the same.
 */
export function ApprovalPolicyInventory({ headingLevel = 2 }: { headingLevel?: 2 | 3 } = {}) {
  const t = useTranslations('platform.workflows.policies');
  const router = useRouter();
  const { can } = usePermissions();
  const canManage = can('manage:workflow');
  // Comparison and version history are reads — gated by the view permission, not the manage one.
  const canView = can('view:workflow');
  const searchId = useId();
  const statusFilterId = useId();

  const { data = [], isPending, isError } = useApprovalPolicies();
  const create = useCreateApprovalPolicyDraft();
  const [open, setOpen] = useState(false);
  const [compareKey, setCompareKey] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<PolicyStatusFilter>('ALL');

  const rows = useMemo(
    () => filterPolicies(data, query, statusFilter),
    [data, query, statusFilter],
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const policyKey = String(form.get('policyKey') ?? '').trim();
    const notes = String(form.get('notes') ?? '').trim();
    if (!policyKey) return;
    create.mutate({ policyKey, ...(notes ? { notes } : {}) }, { onSuccess: () => setOpen(false) });
  }

  return (
    <AdminPanel
      headingLevel={headingLevel}
      title={t('heading')}
      description={t('subheading')}
      actions={
        canManage ? (
          <Button className="shrink-0" onClick={() => setOpen(true)}>
            {t('newDraft')}
          </Button>
        ) : null
      }
    >
      <div className="space-y-4">
        {isPending ? (
          <div className="h-32 animate-pulse rounded-panel border border-border bg-muted" />
        ) : isError ? (
          <Alert variant="error" messages={[t('loadFailed')]} />
        ) : data.length === 0 ? (
          <div className="rounded-panel border border-dashed border-border bg-surface px-6 py-10 text-center text-sm text-muted-foreground">
            {t('empty')}
          </div>
        ) : (
          <>
            <FilterBar>
              <FilterField id={searchId} label={t('searchLabel')} hideLabel grow>
                <Input
                  id={searchId}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('searchPlaceholder')}
                  autoComplete="off"
                />
              </FilterField>
              <FilterField id={statusFilterId} label={t('filterStatus')}>
                <Select
                  id={statusFilterId}
                  value={statusFilter}
                  onChange={(next) => setStatusFilter(next as PolicyStatusFilter)}
                >
                  <option value="ALL">{t('filterAll')}</option>
                  <option value="DRAFT">{t('statusDraft')}</option>
                  <option value="IN_REVIEW">{t('statusInReview')}</option>
                  <option value="SCHEDULED">{t('statusScheduled')}</option>
                  <option value="ACTIVE">{t('statusActive')}</option>
                  <option value="RETIRED">{t('statusRetired')}</option>
                </Select>
              </FilterField>
            </FilterBar>

            <TableScroll aria-label={t('heading')}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colPolicy')}</TableHead>
                    <TableHead>{t('colStatus')}</TableHead>
                    <TableHead className="text-end">{t('colVersion')}</TableHead>
                    <TableHead className="text-end">{t('colRules')}</TableHead>
                    {canView ? <TableHead className="text-end">{t('colActions')}</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableEmpty colSpan={canView ? 5 : 4}>{t('noMatches')}</TableEmpty>
                  ) : (
                    rows.map((policy) => (
                      <TableRow
                        key={policy.id}
                        className="cursor-pointer"
                        onClick={() => router.push(`/admin/workflows/${policy.id}`)}
                      >
                        <TableCell>
                          <div className="font-medium">{policy.policyKey}</div>
                          <div className="text-xs text-muted-foreground">{policy.amountBasis}</div>
                        </TableCell>
                        <TableCell>
                          <Badge tone={policy.status === 'ACTIVE' ? 'live' : 'neutral'}>
                            {policy.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-end tabular-nums">v{policy.version}</TableCell>
                        <TableCell className="text-end tabular-nums">{policy.ruleCount}</TableCell>
                        {canView ? (
                          <TableCell className="text-end whitespace-nowrap">
                            <Button
                              variant="ghost"
                              onClick={(event) => {
                                event.stopPropagation();
                                setCompareKey(policy.policyKey);
                              }}
                            >
                              {t('compareVersions')}
                            </Button>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableScroll>
          </>
        )}

        {canView ? (
          <PolicyVersionComparisonSheet
            policyKey={compareKey}
            onOpenChange={(value) => {
              if (!value) setCompareKey(null);
            }}
          />
        ) : null}

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="p-6 sm:max-w-lg">
            <DialogTitle>{t('newDraft')}</DialogTitle>
            <DialogDescription className="mt-1">{t('draftHint')}</DialogDescription>
            <form onSubmit={submit} className="mt-5 space-y-4">
              <FormField htmlFor="policyKey" label={t('policyKey')} required>
                <Input
                  id="policyKey"
                  name="policyKey"
                  required
                  pattern="[A-Z][A-Z0-9_]{2,79}"
                  placeholder="PURCHASE_ORDER_APPROVAL"
                  disabled={create.isPending}
                />
              </FormField>
              <FormField htmlFor="notes" label={t('notes')}>
                <Textarea id="notes" name="notes" rows={3} disabled={create.isPending} />
              </FormField>
              {create.error ? <Alert variant="error" messages={[t('createFailed')]} /> : null}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  {t('cancel')}
                </Button>
                <Button type="submit" disabled={create.isPending}>
                  {create.isPending ? t('creating') : t('create')}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </AdminPanel>
  );
}
