'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@erp/ui';

import { useModuleTrail } from '@/components/layout/module-chrome';

import { InvoiceCreate } from './invoice-create';
import { ManualInvoiceForm } from './manual-invoice-form';

const TYPES = ['SALE', 'IPC', 'INSTALLMENT', 'SEPARATE_CHARGE'] as const;
export type NewInvoiceType = (typeof TYPES)[number];

const isType = (value: string | null | undefined): value is NewInvoiceType =>
  TYPES.includes(value as NewInvoiceType);

/**
 * New invoice: one page for every kind. A hand-typed sale (ADR-048) is the default; contract
 * billing — a payment certificate, a milestone, a separate charge — is raised from its source
 * (ADR-037). The type lives in `?type=` so a link or the back button lands on the same form.
 */
export function InvoiceNew({ initialType = 'SALE' }: { initialType?: NewInvoiceType }) {
  const t = useTranslations('accounting.invoices.newForm');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const fromUrl = params?.get('type');
  const type: NewInvoiceType = isType(fromUrl) ? fromUrl : initialType;
  const tInvoices = useTranslations('accounting.invoices');
  useModuleTrail(tInvoices('newInvoice'));

  const choose = (next: NewInvoiceType) => {
    const query = new URLSearchParams(params?.toString() ?? '');
    query.set('type', next);
    router.replace(`${pathname}?${query.toString()}`, { scroll: false });
  };

  const typeSwitch = (
    <div
      role="radiogroup"
      aria-label={t('typeLabel')}
      className="flex max-w-full overflow-x-auto rounded-control border border-border bg-surface p-0.5"
    >
      {TYPES.map((value) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={type === value}
          onClick={() => choose(value)}
          className={cn(
            'h-9 shrink-0 whitespace-nowrap rounded-[calc(var(--radius-control)-2px)] px-3 text-body-sm font-medium focus-visible:outline-2 focus-visible:outline-brand-primary',
            type === value
              ? 'bg-brand-accent text-brand-primary'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {t(`type.${value}`)}
        </button>
      ))}
    </div>
  );

  // `key` remounts the form on a type change: nothing typed for one kind leaks into another.
  return type === 'SALE' ? (
    <ManualInvoiceForm key="SALE" typeSwitch={typeSwitch} />
  ) : (
    <InvoiceCreate key={type} kind={type} typeSwitch={typeSwitch} />
  );
}
