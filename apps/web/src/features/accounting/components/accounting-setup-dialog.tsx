'use client';

/**
 * Set up accounting (ADR-040) — the one-step install, in three steps.
 *
 *  1. Your company — the install-time decisions: VAT, banks, first fiscal year.
 *  2. Review the chart — the template preview for those decisions, read-only.
 *  3. Confirm — a plain summary, and the only button that writes anything.
 *
 * A `FormDialog` (ADR-039) size `xl`, mounted to open it. The step state is `useWizard` from
 * `@erp/ui`; the form data stays here. Nothing is saved until step 3 — Back and Cancel are free.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Badge,
  Button,
  ChoiceCards,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
  FormDialogSection,
  FormField,
  Input,
  Notice,
  Select,
  WizardRail,
  cn,
  useWizard,
  type WizardStep,
} from '@erp/ui';
import { Check, Plus, Trash2 } from 'lucide-react';

import { ApiError } from '@/lib/api-client';

import {
  MAX_SETUP_BANKS,
  SETUP_PERIOD_COUNT,
  buildChartPreview,
  emptyBankDraft,
  fiscalYearName,
  fiscalYearRange,
  hasSetupProblems,
  initialSetupDraft,
  monthName,
  parseSetupYear,
  parseVatRate,
  previewAccountCount,
  previewVatRate,
  setupConflict,
  setupProblems,
  toSetupBody,
  type SetupBankDraft,
  type SetupDraft,
  type SetupTemplate,
  type VatMode,
} from '../accounting-setup';
import { useAccountingSetupTemplate, useRunAccountingSetup } from '../hooks/use-accounting';
import { usePartialSetupMessage } from './partial-setup-notice';

type StepId = 'company' | 'review' | 'confirm';

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

export function AccountingSetupDialog({ onDone }: { onDone: () => void }) {
  const t = useTranslations('accounting.setup');
  const tCommon = useTranslations('common');
  const locale = useLocale();

  const [initial] = useState(() => initialSetupDraft());
  const [draft, setDraft] = useState<SetupDraft>(initial);
  const [showErrors, setShowErrors] = useState(false);

  const setup = useRunAccountingSetup();

  const problems = setupProblems(draft);
  const vatCharged = draft.vatMode === 'charged';
  const previewParams = { vatRate: previewVatRate(draft), banks: draft.banks.length };

  const steps: WizardStep<StepId>[] = [
    {
      id: 'company',
      label: t('steps.company'),
      validate: () => {
        setShowErrors(true);
        return !hasSetupProblems(setupProblems(draft));
      },
      render: () => null,
    },
    {
      id: 'review',
      label: t('steps.review'),
      validate: () => template.isSuccess,
      render: () => null,
    },
    { id: 'confirm', label: t('steps.confirm'), render: () => null },
  ];
  const wizard = useWizard(steps);

  // The preview is asked for once the person reaches the review; it is keyed on the VAT rate and
  // the bank count, so changing either on step 1 fetches the matching template.
  const template = useAccountingSetupTemplate(previewParams, {
    enabled: wizard.currentId !== 'company' && !hasSetupProblems(problems),
  });

  const bankNames = draft.banks.map((bank) => bank.accountName.trim() || bank.bankName.trim());
  // A few dozen rows: cheap enough to derive on every render rather than memoise.
  const preview = template.data
    ? buildChartPreview(template.data, { vatCharged, bankNames })
    : null;

  const year = parseSetupYear(draft.year) ?? new Date().getFullYear();
  const range = fiscalYearRange(year, draft.startMonth, locale);
  const fyName = fiscalYearName(year, draft.startMonth);

  // Move focus to the step heading when the step changes, so a keyboard or screen-reader user
  // lands on the new content rather than on a Next button that has just changed meaning.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [wizard.currentIndex]);

  const dirty =
    draft.vatMode !== initial.vatMode ||
    draft.vatRate !== initial.vatRate ||
    draft.year !== initial.year ||
    draft.startMonth !== initial.startMonth ||
    draft.banks.length !== initial.banks.length ||
    draft.banks.some((bank) => bank.accountName || bank.bankName || bank.accountNumber);

  function patchBank(key: string, patch: Partial<SetupBankDraft>) {
    setDraft((d) => ({
      ...d,
      banks: d.banks.map((bank) => (bank.key === key ? { ...bank, ...patch } : bank)),
    }));
  }

  function handleSubmit() {
    if (wizard.isLast) {
      setup.mutate(toSetupBody(draft), { onSuccess: onDone });
      return;
    }
    void wizard.next();
  }

  const partialMessage = usePartialSetupMessage();
  const conflict = setup.isError ? setupConflict(setup.error) : null;
  const serverError = !setup.isError
    ? null
    : conflict?.kind === 'already'
      ? t('confirm.alreadySetUp')
      : conflict?.kind === 'partial'
        ? partialMessage(conflict.existingRecords)
        : setup.error instanceof ApiError
          ? setup.error.message
          : t('review.loadFailed');

  const stepLabel = steps[wizard.currentIndex]?.label ?? '';

  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) onDone();
      }}
      title={t('title')}
      subtitle={t('subtitle')}
      size="xl"
      dirty={dirty}
      busy={setup.isPending}
      closeLabel={tCommon('close')}
      onSubmit={() => handleSubmit()}
      progress={
        <WizardRail
          steps={steps}
          wizard={wizard}
          label={t('stepsLabel')}
          onNavigate={(id) => {
            // Back only: a later step is reached through Next, whose gate re-checks the input.
            if (steps.findIndex((s) => s.id === id) < wizard.currentIndex) wizard.goTo(id);
          }}
        />
      }
    >
      <FormDialogBody className="space-y-6">
        <h3 ref={headingRef} tabIndex={-1} className="sr-only">
          {stepLabel}
        </h3>

        {wizard.currentId === 'company' ? (
          <CompanyStep
            draft={draft}
            setDraft={setDraft}
            patchBank={patchBank}
            showErrors={showErrors}
            range={range}
          />
        ) : null}

        {wizard.currentId === 'review' ? (
          <ReviewStep
            template={template.data}
            isPending={template.isPending}
            isError={template.isError}
            onRetry={() => void template.refetch()}
            preview={preview}
            fyName={fyName}
            banks={draft.banks.length}
          />
        ) : null}

        {wizard.currentId === 'confirm' && template.data && preview ? (
          <ConfirmStep
            accounts={previewAccountCount(preview)}
            profiles={template.data.postingProfiles.length}
            fyName={fyName}
            range={range}
            banks={draft.banks.map((bank) => bank.accountName.trim())}
            vatRate={vatCharged ? parseVatRate(draft.vatRate) : null}
            serverError={serverError}
          />
        ) : null}
      </FormDialogBody>

      <FormDialogFooter
        start={
          wizard.isFirst ? null : (
            <Button
              type="button"
              variant="outline"
              onClick={() => wizard.back()}
              disabled={setup.isPending}
            >
              {tCommon('back')}
            </Button>
          )
        }
      >
        <FormDialogClose asChild>
          <Button type="button" variant="ghost" disabled={setup.isPending}>
            {tCommon('cancel')}
          </Button>
        </FormDialogClose>
        {wizard.isLast ? (
          <Button type="submit" loading={setup.isPending} loadingText={t('confirm.submitting')}>
            {t('confirm.submit')}
          </Button>
        ) : (
          <Button
            type="submit"
            disabled={wizard.currentId === 'review' && !template.isSuccess}
            loading={wizard.validating}
          >
            {tCommon('next')}
          </Button>
        )}
      </FormDialogFooter>
    </FormDialog>
  );
}

// ─── Step 1: Your company ────────────────────────────────────────────────────────

function CompanyStep({
  draft,
  setDraft,
  patchBank,
  showErrors,
  range,
}: {
  draft: SetupDraft;
  setDraft: React.Dispatch<React.SetStateAction<SetupDraft>>;
  patchBank: (key: string, patch: Partial<SetupBankDraft>) => void;
  showErrors: boolean;
  range: { start: string; end: string };
}) {
  const t = useTranslations('accounting.setup');
  const locale = useLocale();
  const ids = { rate: useId(), year: useId(), month: useId() };

  const problems = setupProblems(draft);
  const atMax = draft.banks.length >= MAX_SETUP_BANKS;

  return (
    <div className="space-y-6">
      <FormDialogSection title={t('vat.title')}>
        <ChoiceCards<VatMode>
          label={t('vat.label')}
          value={draft.vatMode}
          onChange={(vatMode) => setDraft((d) => ({ ...d, vatMode }))}
          columns={2}
          options={[
            { value: 'none', label: t('vat.none'), hint: t('vat.noneHint') },
            { value: 'charged', label: t('vat.charged'), hint: t('vat.chargedHint') },
          ]}
        />
        {showErrors && problems.vatChoice ? (
          <p role="alert" className="text-caption text-danger">
            {t('vat.choiceError')}
          </p>
        ) : null}
        {/* Tax codes only: invoice tax is still a fixed rate on the server, whatever is chosen here. */}
        <Notice tone="attention">{t('vat.invoiceTaxNotice')}</Notice>
        {draft.vatMode === 'charged' ? (
          <FormField
            htmlFor={ids.rate}
            label={t('vat.rate')}
            hint={t('vat.rateHint')}
            error={showErrors && problems.vatRate ? t('vat.rateError') : undefined}
            className="max-w-48"
          >
            <Input
              id={ids.rate}
              value={draft.vatRate}
              onChange={(e) => setDraft((d) => ({ ...d, vatRate: e.target.value }))}
              inputMode="decimal"
              autoComplete="off"
              maxLength={6}
            />
          </FormField>
        ) : null}
      </FormDialogSection>

      <FormDialogSection title={t('banks.title')} description={t('banks.description')} variant="plain">
        {draft.banks.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">{t('banks.none')}</p>
        ) : (
          <ol className="space-y-3">
            {draft.banks.map((bank, index) => (
              <BankRow
                key={bank.key}
                bank={bank}
                n={index + 1}
                missing={showErrors ? (problems.banks[bank.key] ?? []) : []}
                onChange={(patch) => patchBank(bank.key, patch)}
                onRemove={() =>
                  setDraft((d) => ({ ...d, banks: d.banks.filter((b) => b.key !== bank.key) }))
                }
              />
            ))}
          </ol>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={atMax}
            onClick={() => setDraft((d) => ({ ...d, banks: [...d.banks, emptyBankDraft()] }))}
          >
            <Plus size={14} aria-hidden="true" />
            {t('banks.add')}
          </Button>
          {atMax ? (
            <span className="text-caption text-muted-foreground">
              {t('banks.max', { max: MAX_SETUP_BANKS })}
            </span>
          ) : null}
        </div>
        <Notice tone="info">{t('banks.pettyCash')}</Notice>
      </FormDialogSection>

      <FormDialogSection title={t('fiscal.title')} description={t('fiscal.description')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            htmlFor={ids.year}
            label={t('fiscal.year')}
            error={showErrors && problems.year ? t('fiscal.yearError') : undefined}
          >
            <Input
              id={ids.year}
              value={draft.year}
              onChange={(e) => setDraft((d) => ({ ...d, year: e.target.value }))}
              inputMode="numeric"
              maxLength={4}
              autoComplete="off"
            />
          </FormField>
          <FormField htmlFor={ids.month} label={t('fiscal.startMonth')}>
            <Select
              id={ids.month}
              // Twelve months are a list to pick from, not to search.
              searchable={false}
              value={String(draft.startMonth)}
              onChange={(value) => setDraft((d) => ({ ...d, startMonth: Number(value) }))}
            >
              {MONTHS.map((m) => (
                <option key={m} value={String(m)}>
                  {monthName(m, locale)}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
        {!problems.year ? (
          <p className="text-body-sm font-medium text-foreground" aria-live="polite">
            {t('fiscal.range', range)}
          </p>
        ) : null}
      </FormDialogSection>
    </div>
  );
}

function BankRow({
  bank,
  n,
  missing,
  onChange,
  onRemove,
}: {
  bank: SetupBankDraft;
  n: number;
  missing: readonly string[];
  onChange: (patch: Partial<SetupBankDraft>) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('accounting.setup.banks');
  const tCommon = useTranslations('common');
  const ids = { name: useId(), bank: useId(), number: useId() };

  return (
    <li className="rounded-panel border border-border bg-surface p-3 sm:p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-caption font-semibold text-muted-foreground">{t('row', { n })}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('remove', { n })}
          onClick={onRemove}
        >
          <Trash2 size={16} aria-hidden="true" />
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField
          htmlFor={ids.name}
          label={t('accountName')}
          error={missing.includes('accountName') ? t('accountNameError') : undefined}
        >
          <Input
            id={ids.name}
            value={bank.accountName}
            placeholder={t('accountNamePlaceholder')}
            onChange={(e) => onChange({ accountName: e.target.value })}
            maxLength={100}
            autoComplete="off"
          />
        </FormField>
        <FormField
          htmlFor={ids.bank}
          label={t('bankName')}
          error={missing.includes('bankName') ? t('bankNameError') : undefined}
        >
          <Input
            id={ids.bank}
            value={bank.bankName}
            placeholder={t('bankNamePlaceholder')}
            onChange={(e) => onChange({ bankName: e.target.value })}
            maxLength={100}
            autoComplete="off"
          />
        </FormField>
        <FormField htmlFor={ids.number} label={`${t('accountNumber')} (${tCommon('optional')})`}>
          <Input
            id={ids.number}
            value={bank.accountNumber}
            onChange={(e) => onChange({ accountNumber: e.target.value })}
            maxLength={50}
            autoComplete="off"
          />
        </FormField>
      </div>
    </li>
  );
}

// ─── Step 2: Review the chart ────────────────────────────────────────────────────

function ReviewStep({
  template,
  isPending,
  isError,
  onRetry,
  preview,
  fyName,
  banks,
}: {
  template: SetupTemplate | undefined;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  preview: ReturnType<typeof buildChartPreview> | null;
  fyName: string;
  banks: number;
}) {
  const t = useTranslations('accounting.setup.review');
  const tClass = useTranslations('accounting.accountClass');

  if (isError) {
    return (
      <Alert
        variant="error"
        messages={[t('loadFailed')]}
        action={
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            {t('retry')}
          </Button>
        }
      />
    );
  }

  if (isPending || !template || !preview) {
    return (
      <div role="status" aria-live="polite" className="space-y-2">
        <span className="sr-only">{t('loading')}</span>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-8 animate-pulse rounded-control bg-muted" aria-hidden="true" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <p className="text-body font-semibold text-foreground">
          {t('counts', {
            accounts: previewAccountCount(preview),
            profiles: template.postingProfiles.length,
            fyName,
            periods: SETUP_PERIOD_COUNT,
            banks,
          })}
        </p>
        <p className="text-caption text-muted-foreground">
          {t('templateVersion', { version: template.version })} · {t('readOnly')}
        </p>
      </div>

      <div className="overflow-x-auto rounded-panel border border-border">
        <table className="w-full min-w-md text-body-sm" aria-label={t('chartLabel')}>
          {preview.map((group) => (
            <tbody key={group.accountClass} className="border-b border-border last:border-b-0">
              <tr className="bg-surface-subtle">
                <th
                  scope="colgroup"
                  colSpan={2}
                  className="px-3 py-2 text-start text-caption font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {tClass(group.accountClass)}
                  <span className="ms-2 font-normal normal-case tracking-normal">
                    {t('classCount', { count: group.rows.length })}
                  </span>
                </th>
              </tr>
              {group.rows.map((row) => (
                <tr key={row.account.code} className="border-t border-border">
                  <td className="w-24 whitespace-nowrap px-3 py-1.5 align-top font-mono text-caption tabular-nums text-muted-foreground">
                    {row.account.code}
                  </td>
                  <td className="px-3 py-1.5">
                    <div
                      className="flex flex-wrap items-center gap-x-2 gap-y-1"
                      style={{ paddingInlineStart: `${row.depth * 1.25}rem` }}
                    >
                      <span
                        className={cn(
                          'text-foreground',
                          row.account.isHeading ? 'font-semibold' : 'font-normal',
                        )}
                      >
                        {row.displayName}
                      </span>
                      {row.account.isHeading ? (
                        <span className="sr-only">({t('heading')})</span>
                      ) : null}
                      {row.account.isControlAccount ? (
                        <Badge tone="neutral">{t('control')}</Badge>
                      ) : null}
                      {row.account.conditional === 'VAT' ? (
                        <Badge tone="progress">{t('vat')}</Badge>
                      ) : null}
                      {row.account.conditional === 'BANK' ? (
                        <Badge tone="progress">{t('bank')}</Badge>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      <details className="group rounded-panel border border-border">
        <summary className="cursor-pointer select-none px-3 py-2.5 text-body-sm font-semibold text-foreground">
          {t('profilesTitle', { count: template.postingProfiles.length })}
        </summary>
        <div className="border-t border-border px-3 py-2">
          <p className="mb-2 text-caption text-muted-foreground">{t('profilesHint')}</p>
          <ul className="divide-y divide-border">
            {template.postingProfiles.map((profile) => (
              <li
                key={profile.code}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-1.5"
              >
                <span className="text-body-sm text-foreground">
                  {profile.name}{' '}
                  <span className="font-mono text-caption text-muted-foreground">
                    {profile.code}
                  </span>
                </span>
                <span className="font-mono text-caption text-muted-foreground">
                  {t('profileAccount', { code: profile.accountCode })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </details>
    </div>
  );
}

// ─── Step 3: Confirm ─────────────────────────────────────────────────────────────

function ConfirmStep({
  accounts,
  profiles,
  fyName,
  range,
  banks,
  vatRate,
  serverError,
}: {
  accounts: number;
  profiles: number;
  fyName: string;
  range: { start: string; end: string };
  banks: string[];
  vatRate: number | null;
  serverError: string | null;
}) {
  const t = useTranslations('accounting.setup.confirm');

  const items = [
    t('accounts', { count: accounts }),
    t('profiles', { count: profiles }),
    t('fiscalYear', { fyName, ...range }),
    t('banks', { count: banks.length, names: banks.join(', ') }),
    vatRate !== null ? t('vatCharged', { rate: String(vatRate) }) : t('vatNone'),
  ];

  return (
    <div className="space-y-5">
      <div>
        <p className="text-body-sm font-medium text-foreground">{t('intro')}</p>
        <ul className="mt-3 space-y-2">
          {items.map((item) => (
            <li key={item} className="flex items-start gap-2.5 text-body-sm text-foreground">
              <Check size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-success" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      <Alert variant="warning" title={t('onceTitle')} messages={[t('onceBody')]} />

      {serverError ? <Alert variant="error" messages={[serverError]} /> : null}
    </div>
  );
}
