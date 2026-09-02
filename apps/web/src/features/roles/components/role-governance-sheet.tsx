'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Badge, Button, FormField, Select, Sheet, SheetContent, SheetDescription, SheetTitle, Textarea } from '@erp/ui';
import type { RoleSummary } from '@erp/types';
import { useUsers } from '@/features/users/hooks/use-users';
import { useCreateRoleAccessReview, useReassignRoleOwner, useRoleAccessReviews, useRoleImpact } from '../hooks/use-roles';

export function RoleGovernanceSheet({ role, onOpenChange }: { role: RoleSummary | null; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations('platform.roles.governance');
  const impact = useRoleImpact(role?.id ?? null); const reviews = useRoleAccessReviews(role?.id ?? null); const users = useUsers();
  const reassign = useReassignRoleOwner(); const review = useCreateRoleAccessReview(); const [ownerId, setOwnerId] = useState(''); const [decision, setDecision] = useState<'CONFIRMED' | 'CHANGES_REQUIRED'>('CONFIRMED'); const [notes, setNotes] = useState('');
  const close = (open: boolean) => { if (!open) { setOwnerId(''); setNotes(''); reassign.reset(); review.reset(); } onOpenChange(open); };
  return <Sheet open={Boolean(role)} onOpenChange={close}><SheetContent className="overflow-y-auto p-6"><SheetTitle>{role?.name}</SheetTitle><SheetDescription className="mt-1">{role?.kind === 'SYSTEM' ? t('systemHint') : t('customHint')}</SheetDescription>
    {impact.isPending ? <div className="mt-5 h-48 animate-pulse rounded-panel bg-muted" /> : impact.data ? <div className="mt-5 space-y-5"><section><h3 className="text-sm font-semibold">{t('impact')}</h3><p className="text-sm text-muted-foreground">{t('memberCount', { count: impact.data.memberCount })}</p><div className="mt-2 flex flex-wrap gap-1">{impact.data.permissions.map(p => <Badge key={p.id} tone={p.riskClass === 'CRITICAL' ? 'danger' : p.riskClass === 'HIGH' ? 'warning' : 'neutral'}>{p.action}:{p.resource} · {p.riskClass}</Badge>)}</div></section>
      {impact.data.warnings.length ? <Alert variant="warning" messages={impact.data.warnings.map(w => w.message)} /> : <Alert variant="success" messages={[t('noWarnings')]} />}
      {role?.kind === 'CUSTOM' ? <section className="space-y-3 border-t border-border pt-4"><h3 className="text-sm font-semibold">{t('owner')}</h3><Select value={ownerId} onChange={value => setOwnerId(value)}><option value="">{t('selectOwner')}</option>{(users.data ?? []).filter(u => u.status === 'ACTIVE').map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName} · {u.email}</option>)}</Select><Button size="sm" disabled={!ownerId || reassign.isPending} onClick={() => role && reassign.mutate({ id: role.id, ownerUserId: ownerId })}>{t('saveOwner')}</Button></section> : null}
      <section className="space-y-3 border-t border-border pt-4"><h3 className="text-sm font-semibold">{t('review')}</h3><Select value={decision} onChange={value => setDecision(value as typeof decision)}><option value="CONFIRMED">{t('confirmed')}</option><option value="CHANGES_REQUIRED">{t('changesRequired')}</option></Select><Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('notes')} rows={3}/><Button size="sm" disabled={review.isPending} onClick={() => role && review.mutate({ id: role.id, decision, ...(notes ? { notes } : {}) })}>{t('submitReview')}</Button><div className="space-y-2">{(reviews.data ?? []).map(r => <div key={r.id} className="rounded-control border border-border p-2 text-sm"><span className="font-medium">{r.decision}</span><span className="ml-2 text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</span>{r.notes ? <p className="mt-1 text-muted-foreground">{r.notes}</p> : null}</div>)}</div></section>
    </div> : <Alert variant="error" messages={[t('loadFailed')]} />}
  </SheetContent></Sheet>;
}
