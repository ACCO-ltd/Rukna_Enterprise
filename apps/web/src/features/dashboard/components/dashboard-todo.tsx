'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ActionList, Button, EmptyState, Panel, type ActionListItem } from '@erp/ui';
import type { DashboardTodoItem } from '@erp/types';
import { CheckCircle2 } from 'lucide-react';

import { formatDate, formatMoney } from '@/lib/format';

type Locale = 'en' | 'ar';
type T = ReturnType<typeof useTranslations<'platform.dashboard.todo'>>;

/** `a · b · c`, skipping parts the server did not have. */
function joined(...parts: (string | null | undefined)[]): string {
  return parts.filter((p): p is string => Boolean(p)).join(' · ');
}

/** The words of one row: what needs doing and why. The server decided whether it is here. */
export function todoText(
  item: DashboardTodoItem,
  t: T,
  locale: Locale,
): { title: string; text?: string } {
  const date = (value: string | null) => formatDate(value, locale);
  switch (item.kind) {
    case 'INVOICE_OVERDUE':
      return {
        title: t('INVOICE_OVERDUE.title', { number: item.invoiceNumber, days: item.daysLate }),
        text: joined(
          item.clientName,
          item.projectName,
          t('INVOICE_OVERDUE.due', { date: date(item.dueDate) ?? '' }),
        ),
      };
    case 'MATERIAL_REQUEST_AWAITING_APPROVAL':
      return {
        title: t('MATERIAL_REQUEST_AWAITING_APPROVAL.title', { number: item.mrNumber }),
        text: joined(
          item.title ?? item.projectName,
          item.requiredByDate
            ? t('MATERIAL_REQUEST_AWAITING_APPROVAL.neededBy', {
                date: date(item.requiredByDate) ?? '',
              })
            : null,
        ),
      };
    case 'BILL_MATCH_EXCEPTION':
      return {
        title: item.billNumber
          ? t('BILL_MATCH_EXCEPTION.title', { number: item.billNumber })
          : t('BILL_MATCH_EXCEPTION.titleNoNumber'),
        text: joined(item.supplierName, t('BILL_MATCH_EXCEPTION.text')),
      };
    case 'BILLS_AWAITING_APPROVAL':
      return {
        title: t('BILLS_AWAITING_APPROVAL.title', { count: item.count }),
        text:
          item.oldestBillNumber && item.oldestSubmittedAt
            ? item.oldestSupplierName
              ? t('BILLS_AWAITING_APPROVAL.oldest', {
                  number: item.oldestBillNumber,
                  supplier: item.oldestSupplierName,
                  date: date(item.oldestSubmittedAt) ?? '',
                })
              : t('BILLS_AWAITING_APPROVAL.oldestNoSupplier', {
                  number: item.oldestBillNumber,
                  date: date(item.oldestSubmittedAt) ?? '',
                })
            : undefined,
      };
    case 'ACCOUNTING_SETUP_INCOMPLETE':
      return {
        title: t('ACCOUNTING_SETUP_INCOMPLETE.title'),
        text: t('ACCOUNTING_SETUP_INCOMPLETE.text', { count: item.stepsLeft }),
      };
    case 'REPORTS_TO_REVIEW':
      return {
        title: t('REPORTS_TO_REVIEW.title', { count: item.count }),
        text: t('REPORTS_TO_REVIEW.text', {
          project: item.projectName,
          date: date(item.oldestReportDate) ?? '',
        }),
      };
    case 'MILESTONE_READY_TO_VERIFY':
      return {
        title: t('MILESTONE_READY_TO_VERIFY.title', { milestone: item.milestoneLabel }),
        text: item.projectName,
      };
    case 'STAGE_READY_TO_BILL': {
      const why = item.milestoneLabel
        ? item.verifiedAt
          ? t('STAGE_READY_TO_BILL.verified', {
              milestone: item.milestoneLabel,
              date: date(item.verifiedAt) ?? '',
            })
          : t('STAGE_READY_TO_BILL.milestone', { milestone: item.milestoneLabel })
        : item.stageLabel;
      return {
        title: t('STAGE_READY_TO_BILL.title', {
          stage: item.stageNumber,
          project: item.projectName,
        }),
        text: [why, item.draftPrepared ? t('STAGE_READY_TO_BILL.draft') : null]
          .filter(Boolean)
          .join(' '),
      };
    }
    case 'PROJECT_READY_TO_START':
      return {
        title: t('PROJECT_READY_TO_START.title', { project: item.projectName }),
        text: t('PROJECT_READY_TO_START.text'),
      };
    case 'PROJECTS_WITHOUT_CONTRACT':
      return {
        title: t('PROJECTS_WITHOUT_CONTRACT.title', { count: item.count }),
        text: t('PROJECTS_WITHOUT_CONTRACT.text'),
      };
  }
}

/**
 * "To do" (P30): the backend's rows in its urgency order, each with one compact button that opens
 * the page where the work is done. No primary button — the dashboard has no primary action.
 */
export function DashboardTodo({ items }: { items: readonly DashboardTodoItem[] }) {
  const t = useTranslations('platform.dashboard.todo');
  const locale = useLocale() as Locale;

  const rows: ActionListItem[] = items.map((item) => {
    const { title, text } = todoText(item, t, locale);
    return {
      key: item.key,
      tone: item.tone,
      title,
      description: text || undefined,
      amount:
        item.amount !== null
          ? (formatMoney(item.amount, item.currency, locale) ?? undefined)
          : undefined,
      action: (
        <Button asChild variant="outline" size="sm">
          <Link href={item.href}>{t(`${item.kind}.action`)}</Link>
        </Button>
      ),
    };
  });

  return (
    <Panel title={t('title', { count: items.length })} flush>
      {rows.length === 0 ? (
        <EmptyState
          variant="inline"
          icon={<CheckCircle2 aria-hidden="true" />}
          title={t('empty')}
          description={t('emptyHint')}
        />
      ) : (
        <ActionList items={rows} aria-label={t('label')} />
      )}
    </Panel>
  );
}
