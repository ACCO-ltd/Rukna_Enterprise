'use client';

import * as React from 'react';
import { ShieldAlert, TriangleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Badge,
  Button,
  DefinitionList,
  DefinitionRow,
  Input,
  Label,
  MoneyInput,
  Skeleton,
  Textarea,
  useToast,
} from '@erp/ui';
import type { AtRiskCommencementResponse, VariationOrderResponse } from '@erp/types';

import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';
import { useSession } from '@/features/auth/session/use-session';

import { useAtRiskCommencements, useRecordAtRiskCommencement } from '../hooks/use-commercial';

/**
 * At-risk commencement (ADR-026 CONST-VAR-011, Phase 5, Route 7B).
 *
 * The audited authorisation to start urgent variation work BEFORE the VO is CLIENT_APPROVED — never
 * an informal verbal instruction. It changes NEITHER the contract value NOR the BOQ; it is an
 * exception the copy names as such, not the normal path.
 *
 * The cap rule (CD + CFO always; + CEO above a config-driven cap) is enforced entirely server-side.
 * This component collects the fields and surfaces the server's 400/403 verbatim as a readable error
 * (CEO required above the cap / CEO forbidden below it / caller not CD-CFO-CEO / reason required). It
 * re-implements no rule; any CEO hint it shows is derived only from a prior authorisation's
 * server-provided `capAmount`, and the server remains the authority.
 */

/** The VO states where starting early is a real thing — everything before CLIENT_APPROVED/terminal. */
const AT_RISK_ELIGIBLE_STATUSES: ReadonlyArray<VariationOrderResponse['status']> = [
  'DRAFT',
  'PENDING_INTERNAL',
  'INTERNAL_APPROVED',
];

export function AtRiskCommencementSection({
  variation,
  contractId,
  projectId,
  canManage,
}: {
  variation: VariationOrderResponse;
  contractId: string;
  projectId: string;
  /** Whether the actor can raise this privileged action (mirrors the sheet's other gated actions). */
  canManage: boolean;
}) {
  const t = useTranslations('commercial.variations.atRisk');
  const locale = useLocale() as 'en' | 'ar';
  const query = useAtRiskCommencements(variation.id);
  const [formOpen, setFormOpen] = React.useState(false);

  const eligible = AT_RISK_ELIGIBLE_STATUSES.includes(variation.status);
  const existing = query.data ?? [];

  return (
    <section className="space-y-3 rounded-control border border-border bg-surface-subtle p-3">
      <div className="flex items-start gap-2">
        <ShieldAlert size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
        <div className="min-w-0">
          <h3 className="text-body-sm font-semibold text-foreground">{t('title')}</h3>
          {/* Names it as an audited exception, and states what it does NOT change. */}
          <p className="mt-0.5 text-caption text-muted-foreground">{t('explainer')}</p>
        </div>
      </div>

      {query.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : query.isError ? (
        <div>
          <p className="text-caption text-muted-foreground">{t('loadFailed')}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => query.refetch()}>
            {t('retry')}
          </Button>
        </div>
      ) : existing.length > 0 ? (
        <ul className="space-y-2">
          {existing.map((auth) => (
            <AuthorisationRow key={auth.id} auth={auth} locale={locale} />
          ))}
        </ul>
      ) : (
        <p className="text-caption italic text-muted-foreground">{t('none')}</p>
      )}

      {formOpen ? (
        <RecordForm
          variationId={variation.id}
          contractId={contractId}
          projectId={projectId}
          onDone={() => setFormOpen(false)}
        />
      ) : eligible && canManage ? (
        <Button variant="outline" size="sm" onClick={() => setFormOpen(true)}>
          {t('record')}
        </Button>
      ) : null}
    </section>
  );
}

function AuthorisationRow({
  auth,
  locale,
}: {
  auth: AtRiskCommencementResponse;
  locale: 'en' | 'ar';
}) {
  const t = useTranslations('commercial.variations.atRisk');

  return (
    <li className="rounded-control border border-border bg-surface px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-body-sm font-semibold tabular-nums text-foreground">
          {formatMoney(auth.exposureAmount, auth.currency, locale) ?? '—'}
        </span>
        {/* The rule outcome snapshotted at authorisation time — server-provided, not derived here. */}
        <Badge tone={auth.ceoRequired ? 'warning' : 'neutral'}>
          {auth.ceoRequired ? t('ceoRequired') : t('ceoNotRequired')}
        </Badge>
      </div>
      <p className="mt-1 text-body-sm text-foreground">{auth.reason}</p>
      <DefinitionList className="mt-1.5">
        <DefinitionRow label={t('cap')} numeric>
          {formatMoney(auth.capAmount, auth.currency, locale) ?? '—'}
        </DefinitionRow>
        <DefinitionRow label={t('cd')}>{auth.constructionDirectorUserId}</DefinitionRow>
        <DefinitionRow label={t('cfo')}>{auth.cfoUserId}</DefinitionRow>
        {auth.ceoUserId ? (
          <DefinitionRow label={t('ceo')}>{auth.ceoUserId}</DefinitionRow>
        ) : null}
        <DefinitionRow label={t('voStatusAt')}>{auth.voStatusAtAuthorisation}</DefinitionRow>
        <DefinitionRow label={t('authorisedBy')}>
          {t('authorisedMeta', {
            by: auth.authorisedBy,
            date: formatDate(auth.authorisedAt, locale) ?? '',
          })}
        </DefinitionRow>
      </DefinitionList>
    </li>
  );
}

function RecordForm({
  variationId,
  contractId,
  projectId,
  onDone,
}: {
  variationId: string;
  contractId: string;
  projectId: string;
  onDone: () => void;
}) {
  const t = useTranslations('commercial.variations.atRisk');
  const tCommon = useTranslations('common');
  const { toast } = useToast();
  const session = useSession();
  const myId = session.user?.id ?? '';

  const record = useRecordAtRiskCommencement(variationId, contractId, projectId);

  const [exposure, setExposure] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [cdId, setCdId] = React.useState('');
  const [cfoId, setCfoId] = React.useState('');
  const [ceoId, setCeoId] = React.useState('');

  // Only reason and the two mandatory authorisers gate the client; the cap/CEO rule is the
  // server's to enforce (we do not guess whether the CEO is required from the exposure).
  const canSubmit =
    reason.trim() !== '' &&
    exposure !== '' &&
    cdId.trim() !== '' &&
    cfoId.trim() !== '' &&
    !record.isPending;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    record.mutate(
      {
        exposureAmount: Number(exposure),
        reason: reason.trim(),
        constructionDirectorUserId: cdId.trim(),
        cfoUserId: cfoId.trim(),
        ceoUserId: ceoId.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast({ title: t('toast.recorded'), tone: 'success' });
          onDone();
        },
        // The server owns the cap rule: a 400 (CEO required above cap / CEO forbidden below /
        // reason required) or 403 (caller not CD/CFO/CEO) surfaces here, verbatim.
        onError: (error) =>
          toast({ title: errorMessage(error, t('toast.recordFailed')), tone: 'error' }),
      },
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-control border border-border bg-surface p-3">
      <div className="flex items-start gap-2">
        <TriangleAlert size={15} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
        <p className="text-caption text-muted-foreground">{t('formWarning')}</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="atrisk-exposure">{t('exposure')}</Label>
        <MoneyInput
          id="atrisk-exposure"
          value={exposure}
          onValueChange={setExposure}
          required
        />
        <p className="text-caption text-muted-foreground">{t('exposureHint')}</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="atrisk-reason">{t('reason')}</Label>
        <Textarea
          id="atrisk-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={1000}
          rows={2}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="atrisk-cd">{t('cd')}</Label>
        <AuthoriserInput id="atrisk-cd" value={cdId} onChange={setCdId} myId={myId} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="atrisk-cfo">{t('cfo')}</Label>
        <AuthoriserInput id="atrisk-cfo" value={cfoId} onChange={setCfoId} myId={myId} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="atrisk-ceo">{t('ceoOptional')}</Label>
        <AuthoriserInput id="atrisk-ceo" value={ceoId} onChange={setCeoId} myId={myId} />
        {/* No client-side cap check — the copy defers the CEO decision to the server. */}
        <p className="text-caption text-muted-foreground">{t('ceoHint')}</p>
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <Button type="submit" size="sm" disabled={!canSubmit}>
          {record.isPending ? tCommon('saving') : t('confirm')}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onDone} disabled={record.isPending}>
          {tCommon('cancel')}
        </Button>
      </div>
    </form>
  );
}

/**
 * A user-id field with a "use my id" convenience — the caller is commonly one of the authorisers,
 * and there is no users directory to pick from. The value is still a free id the server validates.
 */
function AuthoriserInput({
  id,
  value,
  onChange,
  myId,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  myId: string;
}) {
  const t = useTranslations('commercial.variations.atRisk');

  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('userIdPlaceholder')}
        className="flex-1"
      />
      {myId ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(myId)}>
          {t('useMe')}
        </Button>
      ) : null}
    </div>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.messages.length > 0) return error.messages[0]!;
  return fallback;
}
