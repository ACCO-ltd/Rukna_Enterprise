'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert, Button, Combobox, ConfirmDialog, FormField, Input, Notice, SideSheet, SkeletonTable, StatTile, StatusPill, cn } from '@erp/ui';
import { PERMISSIONS, type BankLedgerLine, type BankStatementLineView, type BankStatementWorkspace } from '@erp/types';

import { LoadError } from '@/components/load-error';
import { ListPageHeader } from '@/components/layout/list-page-header';
import { accountName, currentVersion } from '@/features/accounting/account-display';
import { useAccounts } from '@/features/accounting/hooks/use-accounting';
import { usePermissions } from '@/features/auth/permissions/can';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';

import { bankStatementsApi } from './api';
import { statementKeys } from './statements-list';

const usd = (amount: string) => formatMoney(amount, 'USD') ?? amount;
const date = (d: string) => formatDate(d) ?? d;
const STATUS_TONE = { UNMATCHED: 'attention', MATCHED: 'success', POSTED: 'progress' } as const;

/**
 * Step 6 — reconcile one statement. The numbers lead: the bank's closing balance, the ledger, what
 * the bank has not seen yet, and the difference. Then the lines: accept the suggested matches in
 * one go, match the rest by hand, post a charge or interest from its line, and reconcile once
 * every line is matched and the difference is zero.
 */
export function StatementWorkspace({ id }: { id: string }) {
  const t = useTranslations('finance.bankRec.workspace');
  const tRec = useTranslations('finance.bankRec');
  const router = useRouter();
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const mayManage = can(PERMISSIONS.accountingManage);
  const query = useQuery({ queryKey: statementKeys.one(id), queryFn: () => bankStatementsApi.workspace(id) });
  const [matching, setMatching] = useState<BankStatementLineView | null>(null);
  const [posting, setPosting] = useState<BankStatementLineView | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [undoing, setUndoing] = useState<BankStatementLineView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = (w: BankStatementWorkspace) => {
    queryClient.setQueryData(statementKeys.one(id), w);
    void queryClient.invalidateQueries({ queryKey: statementKeys.list() });
    setError(null);
  };
  const onError = (e: unknown) => setError(e instanceof ApiError ? e.message : t('failed'));
  const act = useMutation({ mutationFn: (run: () => Promise<BankStatementWorkspace>) => run(), onSuccess: apply, onError });
  const remove = useMutation({
    mutationFn: () => bankStatementsApi.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: statementKeys.list() });
      router.push('/finance/accounting/bank-reconciliation');
    },
    onError,
  });

  if (query.isError) return <LoadError message={t('loadFailed')} onRetry={() => void query.refetch()} />;
  if (query.isPending) return <SkeletonTable rows={6} columns={5} label={t('loading')} />;

  const w = query.data;
  const open = w.statement.status === 'OPEN';
  const editable = open && mayManage;
  const suggested = w.lines.filter((l) => l.matchStatus === 'UNMATCHED' && l.suggestion).length;
  const r = w.reconciliation;

  const lineActions = (l: BankStatementLineView) => (
    <div className="inline-flex flex-wrap justify-end gap-1">
      {l.matchStatus === 'UNMATCHED' ? (
        <>
          {l.suggestion ? (
            <Button size="sm" variant="outline" onClick={() => act.mutate(() => bankStatementsApi.match(id, l.id, l.suggestion!.journalLineId))}>
              {t('accept')}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => setMatching(l)}>{t('match')}</Button>
          <Button size="sm" variant="ghost" onClick={() => setPosting(l)}>{t('post')}</Button>
        </>
      ) : l.matchStatus === 'MATCHED' ? (
        <Button size="sm" variant="ghost" onClick={() => act.mutate(() => bankStatementsApi.unmatch(id, l.id))}>{t('unmatch')}</Button>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setUndoing(l)}>{t('undo')}</Button>
      )}
    </div>
  );

  return (
    <div className="min-w-0 space-y-6">
      <ListPageHeader
        eyebrow={`${w.statement.bankName} · ${w.statement.accountName}`}
        title={t('title', { from: date(w.statement.periodStart), to: date(w.statement.statementDate) })}
        summary={open ? t('toMatch', { count: w.statement.unmatchedCount }) : t('reconciledOn', { date: date(w.statement.reconciledAt?.slice(0, 10) ?? '') })}
        actions={editable ? (
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(true)} disabled={w.lines.some((l) => l.matchStatus === 'POSTED')}>
              {t('remove')}
            </Button>
            <Button onClick={() => act.mutate(() => bankStatementsApi.reconcile(id))} disabled={!w.canReconcile} loading={act.isPending}>
              {t('reconcile')}
            </Button>
          </>
        ) : (
          <StatusPill tone={open ? 'attention' : 'success'}>{tRec(`status.${w.statement.status}`)}</StatusPill>
        )}
      />

      {error ? <Alert variant="error">{error}</Alert> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label={t('statementClosing')} value={usd(r.statementClosing)} note={t('openingNote', { amount: usd(w.statement.openingBalance) })} />
        <StatTile label={t('ledgerBalance')} value={usd(r.ledgerBalance)} note={t('ledgerNote', { date: date(w.statement.statementDate) })} />
        <StatTile label={t('outstanding')} value={usd(r.outstanding)} note={t('outstandingNote')} />
        <StatTile
          label={t('difference')}
          value={usd(r.difference)}
          note={r.balanced ? t('balanced') : t('notBalanced')}
          className={cn(!r.balanced && 'border-danger/40')}
        />
      </div>

      {open && w.earlierOpenStatementDate ? (
        <Notice tone="attention" title={t('earlierOpenTitle')}>{t('earlierOpenBody', { date: date(w.earlierOpenStatementDate) })}</Notice>
      ) : null}

      {w.previousClosing !== null && w.previousClosing !== w.statement.openingBalance ? (
        <Notice tone="attention">{t('openingMismatch', { previous: usd(w.previousClosing), opening: usd(w.statement.openingBalance) })}</Notice>
      ) : null}

      {editable && suggested > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-brand-primary/30 bg-brand-accent px-4 py-3">
          <p className="text-body-sm text-foreground">{t('suggestedNote', { count: suggested })}</p>
          <Button size="sm" onClick={() => act.mutate(() => bankStatementsApi.acceptSuggestions(id))} loading={act.isPending}>
            {t('acceptAll', { count: suggested })}
          </Button>
        </div>
      ) : null}

      <section className="min-w-0 rounded-panel border border-border bg-surface" aria-label={t('linesTitle')}>
        <ul className="divide-y divide-border sm:hidden">
          <li className="px-4 py-3 text-body font-semibold text-foreground">{t('linesTitle')}</li>
          {w.lines.map((l) => (
            <li key={l.id} className="space-y-1.5 px-4 py-3 text-body-sm">
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block font-medium text-foreground">{l.description}</span>
                  <span className="block text-caption text-muted-foreground">{[date(l.transactionDate), l.reference].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="shrink-0 font-medium tabular-nums">{usd(l.amount)}</span>
              </div>
              <div>
                <StatusPill tone={STATUS_TONE[l.matchStatus]}>{t(`matchStatus.${l.matchStatus}`)}</StatusPill>
                {l.matched ? <LedgerRef line={l.matched} /> : null}
                {!l.matched && l.suggestion ? <span className="mt-0.5 block text-caption text-brand-primary">{t('suggested', { line: ledgerText(l.suggestion) })}</span> : null}
              </div>
              {editable ? <div className="-ms-2">{lineActions(l)}</div> : null}
            </li>
          ))}
        </ul>
        <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[760px] text-body-sm">
          <caption className="px-4 py-3 text-start text-body font-semibold text-foreground">{t('linesTitle')}</caption>
          <thead>
            <tr className="border-y border-border bg-surface-subtle text-caption text-muted-foreground">
              <th scope="col" className="px-4 py-2 text-start font-medium">{t('colDate')}</th>
              <th scope="col" className="px-3 py-2 text-start font-medium">{t('colDescription')}</th>
              <th scope="col" className="px-3 py-2 text-end font-medium">{t('colAmount')}</th>
              <th scope="col" className="px-3 py-2 text-start font-medium">{t('colLedger')}</th>
              {editable ? <th scope="col" className="px-4 py-2 text-end font-medium"><span className="sr-only">{t('colActions')}</span></th> : null}
            </tr>
          </thead>
          <tbody>
            {w.lines.map((l) => (
              <tr key={l.id} className="border-b border-border last:border-b-0">
                <td className="px-4 py-2 tabular-nums">{date(l.transactionDate)}</td>
                <td className="px-3 py-2">
                  {l.description}
                  {l.reference ? <span className="block text-caption text-muted-foreground">{l.reference}</span> : null}
                </td>
                <td className={cn('px-3 py-2 text-end tabular-nums', Number(l.amount) < 0 && 'text-foreground')}>{usd(l.amount)}</td>
                <td className="px-3 py-2">
                  <StatusPill tone={STATUS_TONE[l.matchStatus]}>{t(`matchStatus.${l.matchStatus}`)}</StatusPill>
                  {l.matched ? <LedgerRef line={l.matched} /> : null}
                  {!l.matched && l.suggestion ? (
                    <span className="mt-0.5 block text-caption text-brand-primary">{t('suggested', { line: ledgerText(l.suggestion) })}</span>
                  ) : null}
                </td>
                {editable ? (
                  <td className="px-4 py-2 text-end">
                    {lineActions(l)}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>

      <UnclearedSection lines={w.uncleared} />

      {matching ? (
        <MatchSheet
          line={matching}
          candidates={w.uncleared.filter((u) => u.amount === matching.amount && !u.cancelledOut)}
          onClose={() => setMatching(null)}
          onMatch={(journalLineId) => {
            act.mutate(() => bankStatementsApi.match(id, matching.id, journalLineId));
            setMatching(null);
          }}
        />
      ) : null}
      {posting ? (
        <PostSheet
          line={posting}
          onClose={() => setPosting(null)}
          onPost={(accountId, memo) => {
            act.mutate(() => bankStatementsApi.post(id, posting.id, { accountId, ...(memo ? { memo } : {}) }));
            setPosting(null);
          }}
        />
      ) : null}
      <ConfirmDialog
        open={undoing !== null}
        onOpenChange={(o) => { if (!o) setUndoing(null); }}
        title={t('undoTitle')}
        description={t('undoBody', { amount: usd(undoing?.amount ?? '0') })}
        confirmLabel={t('undo')}
        cancelLabel={t('cancel')}
        isPending={act.isPending}
        onConfirm={() => {
          const line = undoing!;
          act.mutate(() => bankStatementsApi.undo(id, line.id), { onSettled: () => setUndoing(null) });
        }}
      />
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={t('removeTitle')}
        description={t('removeBody')}
        confirmLabel={t('remove')}
        cancelLabel={t('cancel')}
        variant="destructive"
        isPending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}

function ledgerText(l: BankLedgerLine): string {
  return `${l.journalNumber ?? '—'} · ${date(l.accountingDate)}`;
}

/** The ledger entry a line matched: its journal (opening it) and what it was. */
function LedgerRef({ line }: { line: BankLedgerLine }) {
  return (
    <span className="mt-0.5 block text-caption text-muted-foreground">
      <Link href={`/finance/accounting/journals/${line.journalEntryId}`} className="font-mono hover:text-foreground hover:underline">{line.journalNumber ?? '—'}</Link>
      {' · '}{date(line.accountingDate)}
      {line.description ? <span className="block truncate">{line.description}</span> : null}
    </span>
  );
}

/**
 * Ledger entries not on a statement yet: what the bank has still to show (outstanding), what was
 * there before reconciliation began, and entries recorded then reversed (they cancel out).
 */
function UnclearedSection({ lines }: { lines: BankLedgerLine[] }) {
  const t = useTranslations('finance.bankRec.workspace');
  const groups = [
    { key: 'outstanding', title: t('unclearedTitle'), rows: lines.filter((l) => !l.cancelledOut && !l.broughtForward) },
    { key: 'broughtForward', title: t('broughtForwardTitle'), rows: lines.filter((l) => !l.cancelledOut && l.broughtForward) },
    { key: 'cancelled', title: t('cancelledTitle'), rows: lines.filter((l) => l.cancelledOut) },
  ];
  return (
    <section className="rounded-panel border border-border bg-surface" aria-label={t('unclearedTitle')}>
      {groups.map((g, i) =>
        g.rows.length === 0 && i > 0 ? null : (
          <div key={g.key} className={cn(i > 0 && 'border-t border-border')}>
            <h2 className="px-4 py-3 text-body font-semibold text-foreground">
              {g.title}
              {g.key === 'cancelled' ? <span className="block text-caption font-normal text-muted-foreground">{t('cancelledNote')}</span> : null}
            </h2>
            {g.rows.length === 0 ? (
              <p className="border-t border-border px-4 py-3 text-body-sm text-muted-foreground">{t('unclearedNone')}</p>
            ) : (
              <ul className="divide-y divide-border border-t border-border">
                {g.rows.map((u) => (
                  <li key={u.journalLineId} className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 text-body-sm', g.key === 'cancelled' && 'text-muted-foreground')}>
                    <span className="min-w-0">
                      <Link href={`/finance/accounting/journals/${u.journalEntryId}`} className="font-mono hover:underline">{u.journalNumber ?? '—'}</Link>
                      {' · '}{date(u.accountingDate)}
                      {u.description ? <span className="block truncate text-caption text-muted-foreground">{u.description}</span> : null}
                    </span>
                    <span className="tabular-nums">{usd(u.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ),
      )}
    </section>
  );
}

function MatchSheet({ line, candidates, onClose, onMatch }: {
  line: BankStatementLineView;
  candidates: BankLedgerLine[];
  onClose: () => void;
  onMatch: (journalLineId: string) => void;
}) {
  const t = useTranslations('finance.bankRec.workspace');
  return (
    <SideSheet open onOpenChange={(o) => !o && onClose()} title={t('matchTitle')} description={t('matchBody', { amount: usd(line.amount), date: date(line.transactionDate) })} closeLabel={t('cancel')}>
      {candidates.length === 0 ? (
        <Notice tone="info">{t('noCandidates')}</Notice>
      ) : (
        <ul className="divide-y divide-border rounded-panel border border-border">
          {candidates.map((c) => (
            <li key={c.journalLineId} className="flex items-center justify-between gap-3 px-3 py-2 text-body-sm">
              <span className="min-w-0">
                {ledgerText(c)}
                {c.description ? <span className="block truncate text-caption text-muted-foreground">{c.description}</span> : null}
              </span>
              <Button size="sm" variant="outline" onClick={() => onMatch(c.journalLineId)}>{t('matchThis')}</Button>
            </li>
          ))}
        </ul>
      )}
    </SideSheet>
  );
}

function PostSheet({ line, onClose, onPost }: { line: BankStatementLineView; onClose: () => void; onPost: (accountId: string, memo: string) => void }) {
  const t = useTranslations('finance.bankRec.workspace');
  const accounts = useAccounts();
  const [accountId, setAccountId] = useState('');
  const [memo, setMemo] = useState(line.description);
  const options = useMemo(
    () =>
      (accounts.data ?? [])
        .filter((a) => {
          const v = currentVersion(a);
          return v && v.isPostingAllowed && !v.isControlAccount && (v.accountClass === 'EXPENSE' || v.accountClass === 'INCOME');
        })
        .map((a) => ({ value: a.id, label: `${a.code} ${accountName(a)}` })),
    [accounts.data],
  );
  const moneyIn = Number(line.amount) > 0;
  return (
    <SideSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={moneyIn ? t('postInTitle') : t('postOutTitle')}
      description={t('postBody', { amount: usd(line.amount), date: date(line.transactionDate) })}
      closeLabel={t('cancel')}
      footer={<Button onClick={() => onPost(accountId, memo.trim())} disabled={!accountId}>{t('postConfirm')}</Button>}
    >
      <div className="space-y-4">
        <FormField htmlFor="post-account" label={moneyIn ? t('incomeAccount') : t('expenseAccount')} required>
          <Combobox id="post-account" value={accountId} onChange={setAccountId} options={options} placeholder={t('chooseAccount')} searchPlaceholder={t('searchAccount')} emptyLabel={t('noAccount')} />
        </FormField>
        <FormField htmlFor="post-memo" label={t('memo')}>
          <Input id="post-memo" value={memo} onChange={(e) => setMemo(e.target.value)} />
        </FormField>
      </div>
    </SideSheet>
  );
}
