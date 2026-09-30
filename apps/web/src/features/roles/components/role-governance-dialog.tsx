'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Badge,
  Button,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
  FormDialogSection,
  Select,
  Textarea,
} from '@erp/ui';
import type { RoleSummary } from '@erp/types';
import { useUsers } from '@/features/users/hooks/use-users';
import {
  useCreateRoleAccessReview,
  useReassignRoleOwner,
  useRoleAccessReviews,
  useRoleImpact,
} from '../hooks/use-roles';

/**
 * A role's governance: its impact (members, permissions and their risk class, warnings), its
 * owner (custom roles only) and its access reviews. A `FormDialog` (ADR-039), size `lg` — a
 * record with a short list — grouped into sections. Reassigning the owner and recording a review
 * each act at once from their own section, so the footer only closes; a half-written review or an
 * unsaved owner choice is asked about before the dialog is dismissed.
 */
export function RoleGovernanceDialog({
  role,
  onOpenChange,
}: {
  role: RoleSummary | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('platform.roles.governance');
  const tc = useTranslations('common');
  const impact = useRoleImpact(role?.id ?? null);
  const reviews = useRoleAccessReviews(role?.id ?? null);
  const users = useUsers();
  const reassign = useReassignRoleOwner();
  const review = useCreateRoleAccessReview();
  const [ownerId, setOwnerId] = useState('');
  const [decision, setDecision] = useState<'CONFIRMED' | 'CHANGES_REQUIRED'>('CONFIRMED');
  const [notes, setNotes] = useState('');

  const close = (open: boolean) => {
    if (!open) {
      setOwnerId('');
      setNotes('');
      reassign.reset();
      review.reset();
    }
    onOpenChange(open);
  };

  return (
    <FormDialog
      open={Boolean(role)}
      onOpenChange={close}
      size="lg"
      title={role?.name ?? ''}
      subtitle={role?.kind === 'SYSTEM' ? t('systemHint') : t('customHint')}
      initialFocus="dialog"
      dirty={ownerId !== '' || notes.trim() !== ''}
      busy={reassign.isPending || review.isPending}
      closeLabel={tc('close')}
    >
      <FormDialogBody>
        {impact.isPending ? (
          <div className="h-48 animate-pulse rounded-panel bg-muted" aria-hidden="true" />
        ) : impact.data ? (
          <>
            <FormDialogSection title={t('impact')}>
              <p className="text-sm text-muted-foreground">
                {t('memberCount', { count: impact.data.memberCount })}
              </p>
              <div className="flex flex-wrap gap-1">
                {impact.data.permissions.map((p) => (
                  <Badge
                    key={p.id}
                    tone={p.riskClass === 'CRITICAL' ? 'danger' : p.riskClass === 'HIGH' ? 'warning' : 'neutral'}
                  >
                    {p.action}:{p.resource} · {p.riskClass}
                  </Badge>
                ))}
              </div>
              {impact.data.warnings.length ? (
                <Alert variant="warning" messages={impact.data.warnings.map((w) => w.message)} />
              ) : (
                <Alert variant="success" messages={[t('noWarnings')]} />
              )}
            </FormDialogSection>

            {role?.kind === 'CUSTOM' ? (
              <FormDialogSection title={t('owner')}>
                <Select
                  aria-label={t('owner')}
                  value={ownerId}
                  onChange={(value) => setOwnerId(value)}
                >
                  <option value="">{t('selectOwner')}</option>
                  {(users.data ?? [])
                    .filter((u) => u.status === 'ACTIVE')
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.firstName} {u.lastName} · {u.email}
                      </option>
                    ))}
                </Select>
                <div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!ownerId || reassign.isPending}
                    onClick={() =>
                      role &&
                      reassign.mutate(
                        { id: role.id, ownerUserId: ownerId },
                        { onSuccess: () => setOwnerId('') },
                      )
                    }
                  >
                    {t('saveOwner')}
                  </Button>
                </div>
              </FormDialogSection>
            ) : null}

            <FormDialogSection title={t('review')}>
              <Select
                aria-label={t('review')}
                value={decision}
                onChange={(value) => setDecision(value as typeof decision)}
              >
                <option value="CONFIRMED">{t('confirmed')}</option>
                <option value="CHANGES_REQUIRED">{t('changesRequired')}</option>
              </Select>
              <Textarea
                aria-label={t('notes')}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('notes')}
                rows={3}
              />
              <div>
                <Button
                  size="sm"
                  disabled={review.isPending}
                  onClick={() =>
                    role &&
                    review.mutate(
                      { id: role.id, decision, ...(notes ? { notes } : {}) },
                      { onSuccess: () => setNotes('') },
                    )
                  }
                >
                  {t('submitReview')}
                </Button>
              </div>
              <div className="space-y-2">
                {(reviews.data ?? []).map((r) => (
                  <div key={r.id} className="rounded-control border border-border p-2 text-sm">
                    <span className="font-medium">{r.decision}</span>
                    <span className="ms-2 text-muted-foreground">
                      {new Date(r.createdAt).toLocaleString()}
                    </span>
                    {r.notes ? <p className="mt-1 text-muted-foreground">{r.notes}</p> : null}
                  </div>
                ))}
              </div>
            </FormDialogSection>
          </>
        ) : (
          <Alert variant="error" messages={[t('loadFailed')]} />
        )}
      </FormDialogBody>
      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="outline">
            {tc('close')}
          </Button>
        </FormDialogClose>
      </FormDialogFooter>
    </FormDialog>
  );
}
