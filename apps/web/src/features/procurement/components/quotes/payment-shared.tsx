'use client';

/**
 * Pieces the payment screens share (ADR-045): a server refusal in plain words, the state pill,
 * and the set-up blockers explained with a link to fix them (P14).
 */

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Notice, StatusPill } from '@erp/ui';
import { ArrowRight } from 'lucide-react';

import { statusTone } from '@/lib/status-registry';

import { refusalCode, useRefusalText } from './quote-shared';
import type { PaymentState, StoreDocumentStatus } from '../../quotations/payment-types';

/**
 * A refusal or a disabled reason in plain words: the payment vocabulary first (funding cap, cash
 * accounts, SoD rules on money), then the quotation one, then the server's own message. The
 * frontend never decides these rules — it says what the server decided.
 */
export function usePaymentRefusalText(): {
  fromError: (error: unknown) => string | undefined;
  fromCode: (code: string | null | undefined) => string | undefined;
} {
  const t = useTranslations('procurement.quotes.payment.refusal');
  const tQuote = useTranslations('procurement.quotes.refusal');
  const quoteText = useRefusalText();
  const fromCode = (code: string | null | undefined) => {
    if (!code) return undefined;
    if (t.has(code)) return t(code);
    if (tQuote.has(code)) return tQuote(code);
    return undefined;
  };
  const fromError = (error: unknown) => {
    if (!error) return undefined;
    return fromCode(refusalCode(error)) ?? quoteText(error);
  };
  return { fromError, fromCode };
}

export function PaymentStatePill({ state }: { state: PaymentState }) {
  const t = useTranslations('procurement.quotes.payment.state');
  return <StatusPill tone={statusTone(state, 'quotationPayment')}>{t(state)}</StatusPill>;
}

export function StoreDocumentStatusPill({ status }: { status: StoreDocumentStatus }) {
  const t = useTranslations('procurement.quotes.payment.documents.status');
  return <StatusPill tone={statusTone(status, 'storeDocument')}>{t(status)}</StatusPill>;
}

/** Where each set-up blocker is fixed. Bank accounts open with the cash-box preset (P14). */
const SETUP_LINKS: Record<string, { href: string; labelKey: 'setUpCash' | 'setUpProfile' | 'setUpPeriods' }> = {
  NO_ELIGIBLE_CASH_ACCOUNT: { href: '/finance/accounting/bank-accounts?preset=cash-box', labelKey: 'setUpCash' },
  NO_CASH_ACCOUNT: { href: '/finance/accounting/bank-accounts?preset=cash-box', labelKey: 'setUpCash' },
  ACCOUNT_REQUIRES_DUAL_CONTROL: { href: '/finance/accounting/bank-accounts?preset=cash-box', labelKey: 'setUpCash' },
  'POSTING_ACCOUNT_NOT_CONFIGURED:STAFF_ADVANCE': {
    href: '/finance/accounting/posting-profiles',
    labelKey: 'setUpProfile',
  },
  STAFF_ADVANCE_NOT_CONFIGURED: { href: '/finance/accounting/posting-profiles', labelKey: 'setUpProfile' },
  PERIOD_CLOSED: { href: '/finance/accounting/periods', labelKey: 'setUpPeriods' },
  PERIOD_LOCKED: { href: '/finance/accounting/periods', labelKey: 'setUpPeriods' },
};

/**
 * The draft endpoint's blockers, each in words — and where a blocker is missing set-up (no cash
 * account without signatories, no Staff advances profile), a link to set it up.
 */
export function PaymentBlockers({ codes }: { codes: string[] }) {
  const t = useTranslations('procurement.quotes.payment.blockers');
  const { fromCode } = usePaymentRefusalText();
  if (codes.length === 0) return null;
  return (
    <Notice tone="attention" title={t('title')}>
      <ul className="mt-1 space-y-2">
        {codes.map((code) => {
          const link = SETUP_LINKS[code];
          return (
            <li key={code}>
              <p>{fromCode(code) ?? code}</p>
              {link ? (
                <Link
                  href={link.href}
                  className="mt-1 inline-flex min-h-11 items-center gap-1 font-medium text-brand-primary underline underline-offset-4"
                >
                  {t(link.labelKey)}
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Notice>
  );
}
