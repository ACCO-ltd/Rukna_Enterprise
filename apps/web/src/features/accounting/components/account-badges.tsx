'use client';

import { useTranslations } from 'next-intl';
import { Badge, type BadgeTone } from '@erp/ui';

import type { AccountClass, ControlPostingPolicy, NormalBalance } from '../types';

/**
 * Account class tones follow the accounting equation rather than a rainbow: the two sides of
 * the balance sheet read differently from the two sides of the income statement, so a glance
 * down the class column separates position from performance.
 */
const CLASS_TONES: Record<AccountClass, BadgeTone> = {
  ASSET: 'info',
  LIABILITY: 'accent',
  EQUITY: 'accent',
  INCOME: 'live',
  COST_OF_SALES: 'warning',
  EXPENSE: 'warning',
};

export function AccountClassBadge({ accountClass }: { accountClass: AccountClass }) {
  const t = useTranslations('accounting.accountClass');
  return <Badge tone={CLASS_TONES[accountClass] ?? 'neutral'}>{t(accountClass)}</Badge>;
}

/**
 * Whether the account can be posted to, and by whom.
 *
 * A control account is the one distinction that matters on this screen: it is not "blocked" in
 * the sense of being switched off, it is reserved for the posting engine, and someone looking
 * for why their journal will not accept it needs that difference stated.
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
      <Badge tone="warning" title={t('controlAccountHint')}>
        {t('systemOnly')}
      </Badge>
    );
  }

  if (controlPostingPolicy === 'SYSTEM_OR_APPROVED_ADJUSTMENT') {
    return <Badge tone="info">{t('systemOrApproved')}</Badge>;
  }

  return <Badge tone="live">{t('postingAllowed')}</Badge>;
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
