'use client';

import { useTranslations } from 'next-intl';
import { Badge, Tooltip, TooltipContent, TooltipTrigger } from '@erp/ui';

import type { AccountClass, ControlPostingPolicy, NormalBalance } from '../types';

/**
 * Account class is a classification, not a status (ADR-034): it has no lifecycle, so it renders
 * as a plain neutral badge without a dot. The word carries the distinction.
 */
export function AccountClassBadge({ accountClass }: { accountClass: AccountClass }) {
  const t = useTranslations('accounting.accountClass');
  return <Badge tone="neutral">{t(accountClass)}</Badge>;
}

/**
 * Whether the account can be posted to, and by whom.
 *
 * A control account is the one distinction that matters on this screen: it is not "blocked" in
 * the sense of being switched off, it is reserved for the posting engine, and someone looking
 * for why their journal will not accept it needs that difference stated.
 *
 * A property of the account rather than a lifecycle status, so it stays a plain badge: neutral,
 * with only the reserved (system-only) case drawing attention.
 */
export function PostingPolicyBadge({
  isPostingAllowed,
  isControlAccount,
  controlPostingPolicy,
}: {
  isPostingAllowed: boolean;
  isControlAccount: boolean;
  controlPostingPolicy: ControlPostingPolicy;
}) {
  const t = useTranslations('accounting.chartOfAccounts');

  if (!isPostingAllowed) {
    return <Badge tone="neutral">{t('postingBlocked')}</Badge>;
  }

  if (isControlAccount || controlPostingPolicy === 'SYSTEM_ONLY') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge tone="attention">{t('systemOnly')}</Badge>
        </TooltipTrigger>
        <TooltipContent>{t('controlAccountHint')}</TooltipContent>
      </Tooltip>
    );
  }

  if (controlPostingPolicy === 'SYSTEM_OR_APPROVED_ADJUSTMENT') {
    return <Badge tone="neutral">{t('systemOrApproved')}</Badge>;
  }

  return <Badge tone="neutral">{t('postingAllowed')}</Badge>;
}

/**
 * `DEBIT` and `CREDIT` are not statuses and must not read as good or bad — they are which
 * direction increases the account. Neutral in both cases, distinguished by the word alone.
 */
export function NormalBalanceLabel({ normalBalance }: { normalBalance: NormalBalance }) {
  const t = useTranslations('accounting.common');
  return (
    <span className="text-sm text-muted-foreground">
      {normalBalance === 'DEBIT' ? t('debit') : t('credit')}
    </span>
  );
}
