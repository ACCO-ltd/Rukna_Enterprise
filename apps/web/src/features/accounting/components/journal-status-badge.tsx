'use client';

import { useTranslations } from 'next-intl';
import { StatusPill } from '@erp/ui';

import { statusTone } from '@/lib/status-registry';

import type { JournalStatus } from '../types';

/** A journal entry's lifecycle status. Tone from the status registry (ADR-034). */
export function JournalStatusBadge({ status }: { status: JournalStatus }) {
  const t = useTranslations('accounting.journals.status');
  return <StatusPill tone={statusTone(status, 'journal')}>{t(status)}</StatusPill>;
}
