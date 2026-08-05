'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Alert, cn } from '@erp/ui';

import { useContract } from '@/features/contracts/hooks/use-contracts';
import { useIpa } from '@/features/ipa/hooks/use-ipa';
import { useBoqTree } from '@/features/boq/hooks/use-boq';
import { ApiError } from '@/lib/api-client';
import type { BoqTreeNode } from '@/lib/api-types';

import { useIpcs, useIssueIpc } from '../hooks/use-ipc';
import {
  clearDraft,
  emptyContext,
  loadDraft,
  saveDraft,
  type AdHocDeduction,
  type CertRow,
  type WizardContext,
  type WizardDraft,
} from './draft';
import { Step1Context } from './step-1-context';
import { Step2Items } from './step-2-items';
import { Step3Review } from './step-3-review';

interface IpcWizardProps {
  contractId: string;
  ipaId: string;
}

type Step = 1 | 2 | 3;

// ─── Step progress bar ────────────────────────────────────────────────────────

function ProgressBar({ step, isRejected }: { step: Step; isRejected: boolean }) {
  const t = useTranslations('platform.ipc.wizard.progress');

  const steps = isRejected
    ? [
        { num: 1 as Step, label: t('step1') },
        { num: 3 as Step, label: t('step3') },
      ]
    : [
        { num: 1 as Step, label: t('step1') },
        { num: 2 as Step, label: t('step2') },
        { num: 3 as Step, label: t('step3') },
      ];

  const stepNums = steps.map((s) => s.num);
  const currentIndex = stepNums.indexOf(step);

  return (
    <nav aria-label="Progress" className="mb-8">
      <ol className="flex items-center gap-0">
        {steps.map((s, idx) => {
          const isDone = stepNums.indexOf(step) > idx;
          const isCurrent = s.num === step;

          return (
            <li key={s.num} className="flex flex-1 items-center">
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors',
                    isDone && 'bg-brand-primary text-white',
                    isCurrent && 'border-2 border-brand-primary text-brand-primary',
                    !isDone && !isCurrent && 'border-2 border-border text-muted-foreground',
                  )}
                  aria-current={isCurrent ? 'step' : undefined}
                >
                  {isDone ? (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      aria-hidden="true"
                    >
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  ) : (
                    idx + 1
                  )}
                </div>
                <span
                  className={cn(
                    'hidden text-xs sm:block',
                    isCurrent && 'font-medium text-foreground',
                    !isCurrent && 'text-muted-foreground',
                  )}
                >
                  {s.label}
                </span>
              </div>

              {/* Connector line — not after the last step */}
              {idx < steps.length - 1 ? (
                <div
                  className={cn(
                    'mx-2 h-0.5 flex-1',
                    currentIndex > idx ? 'bg-brand-primary' : 'bg-border',
                  )}
                  aria-hidden="true"
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ─── Main wizard ──────────────────────────────────────────────────────────────

export function IpcWizard({ contractId, ipaId }: IpcWizardProps) {
  const t = useTranslations('platform.ipc.wizard');
  const router = useRouter();

  const ipa = useIpa(ipaId);
  const contract = useContract(contractId);
  const ipcs = useIpcs(ipaId);
  const issue = useIssueIpc(ipaId);

  // BOQ tree loaded after contract resolves
  const projectId = contract.data?.projectId ?? '';
  const boqVersionId = contract.data?.boqVersionId ?? null;
  const boqTree = useBoqTree(projectId, boqVersionId);

  // ── Wizard state ────────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>(1);
  const [context, setContext] = useState<WizardContext>(emptyContext());
  const [rows, setRows] = useState<CertRow[]>([]);
  const [adHocDeductions, setAdHocDeductions] = useState<AdHocDeduction[]>([]);
  const [draftRestored, setDraftRestored] = useState(false);
  const [step1Errors, setStep1Errors] = useState<Partial<Record<keyof WizardContext, string>>>({});
  const [step2Errors, setStep2Errors] = useState<Record<string, string>>({});

  // ── Restore draft on mount ──────────────────────────────────────────────────
  useEffect(() => {
    const saved = loadDraft(ipaId);
    if (saved) {
      setContext(saved.context);
      setRows(saved.rows);
      setAdHocDeductions(saved.adHocDeductions);
      setDraftRestored(true);
    }
  }, [ipaId]);

  // ── Initialize rows from IPA items (only when no draft) ─────────────────────
  useEffect(() => {
    if (!ipa.data || draftRestored) return;
    setRows(
      ipa.data.items.map((item) => ({
        applicationItemId: item.id,
        certifiedQuantity: item.cumulativeClaimed,
        varianceReason: '',
      })),
    );
  }, [ipa.data, draftRestored]);

  // ── Persist draft on every change ──────────────────────────────────────────
  useEffect(() => {
    if (!ipa.data) return;
    saveDraft(ipaId, { context, rows, adHocDeductions });
  }, [ipaId, context, rows, adHocDeductions, ipa.data]);

  // ── BOQ node map ────────────────────────────────────────────────────────────
  const nodeMap = useMemo(() => {
    if (!boqTree.data) return {};
    const flat: BoqTreeNode[] = [];
    const flatten = (nodes: typeof boqTree.data) => {
      for (const n of nodes) {
        flat.push(n);
        if (n.children.length) flatten(n.children);
      }
    };
    flatten(boqTree.data);
    return Object.fromEntries(flat.map((n) => [n.id, n]));
  }, [boqTree.data]);

  // ── Check for existing effective certificate ─────────────────────────────────
  const hasEffectiveCert = ipcs.data?.some((c) => c.isEffective) ?? false;

  // ── Loading / error states ──────────────────────────────────────────────────
  const tCommon = useTranslations('common');
  if (ipa.isPending || contract.isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
        <div className="h-64 animate-pulse rounded-lg border border-border bg-muted" aria-hidden="true" />
      </div>
    );
  }

  if (ipa.isError || contract.isError) {
    const notFound = ipa.error instanceof ApiError && ipa.error.status === 404;
    return (
      <Alert
        variant="error"
        messages={[notFound ? 'Application not found.' : 'Failed to load data.']}
      />
    );
  }

  // ── Validation ──────────────────────────────────────────────────────────────
  function validateStep1(): boolean {
    if (!context.status) {
      setStep1Errors({ status: t('step1.statusRequired') });
      return false;
    }
    setStep1Errors({});
    return true;
  }

  function validateStep2(): boolean {
    const errs: Record<string, string> = {};
    for (const row of rows) {
      const qty = parseFloat(row.certifiedQuantity);
      if (isNaN(qty) || row.certifiedQuantity === '') {
        errs[row.applicationItemId] = t('step2.certifiedRequired');
      } else {
        const item = ipa.data!.items.find((i) => i.id === row.applicationItemId);
        if (item) {
          const claimed = parseFloat(item.cumulativeClaimed);
          const diff = Math.abs(qty - claimed);
          if (diff > 0.0005 && !row.varianceReason.trim()) {
            errs[row.applicationItemId] = t('step2.varianceReasonRequired');
          }
        }
      }
    }
    setStep2Errors(errs);
    return Object.keys(errs).length === 0;
  }

  // ── Navigation ──────────────────────────────────────────────────────────────
  function handleStep1Next() {
    if (!validateStep1()) return;
    setStep(context.status === 'REJECTED' ? 3 : 2);
  }

  function handleStep2Next() {
    if (!validateStep2()) return;
    setStep(3);
  }

  // ── Row update helpers ───────────────────────────────────────────────────────
  function updateRow(applicationItemId: string, patch: Partial<CertRow>) {
    setRows((prev) =>
      prev.map((r) => (r.applicationItemId === applicationItemId ? { ...r, ...patch } : r)),
    );
  }

  // ── Ad-hoc deduction helpers ────────────────────────────────────────────────
  function addAdHoc() {
    setAdHocDeductions((prev) => [
      ...prev,
      {
        key: `${Date.now()}-${Math.random()}`,
        deductionType: 'TAX',
        basis: '',
        amount: '',
      },
    ]);
  }

  function updateAdHoc(key: string, patch: Partial<AdHocDeduction>) {
    setAdHocDeductions((prev) =>
      prev.map((d) => (d.key === key ? { ...d, ...patch } : d)),
    );
  }

  function removeAdHoc(key: string) {
    setAdHocDeductions((prev) => prev.filter((d) => d.key !== key));
  }

  // ── Issue ────────────────────────────────────────────────────────────────────
  function handleIssue() {
    const isRejected = context.status === 'REJECTED';
    const payload = {
      applicationId: ipaId,
      status: context.status as 'CERTIFIED' | 'PARTIALLY_CERTIFIED' | 'REJECTED',
      currency: contract.data!.currency,
      ...(context.showExchangeRate && context.exchangeRateCurrency
        ? {
            exchangeRateCurrency: context.exchangeRateCurrency || undefined,
            exchangeRateBase: context.exchangeRateBase || undefined,
            exchangeRateValue: context.exchangeRateValue || undefined,
            exchangeRateDate: context.exchangeRateDate || undefined,
          }
        : {}),
      notes: context.notes || undefined,
      items: isRejected
        ? []
        : rows.map((r) => ({
            applicationItemId: r.applicationItemId,
            certifiedQuantity: r.certifiedQuantity,
            ...(r.varianceReason ? { varianceReason: r.varianceReason } : {}),
          })),
      deductions: isRejected
        ? []
        : adHocDeductions
            .filter((d) => d.amount && parseFloat(d.amount) > 0)
            .map((d) => ({
              deductionType: d.deductionType,
              basis: d.basis,
              amount: d.amount,
            })),
    };

    issue.mutate(payload, {
      onSuccess: () => {
        clearDraft(ipaId);
        router.push(`/contracts/${contractId}/applications/${ipaId}`);
      },
    });
  }

  // ── Failure message ──────────────────────────────────────────────────────────
  const issueError = issue.isError
    ? (issue.error instanceof ApiError && issue.error.message
        ? issue.error.message
        : t('step3.issueFailed'))
    : undefined;

  const isRejected = context.status === 'REJECTED';

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>

      {hasEffectiveCert ? (
        <Alert variant="warning" messages={[t('effectiveCertWarning')]} />
      ) : null}

      {draftRestored ? (
        <Alert variant="info" messages={[t('draftRestoredHint')]} />
      ) : null}

      <ProgressBar step={step} isRejected={isRejected} />

      {/* Step heading */}
      <div>
        <h2 className="text-lg font-medium text-foreground">
          {step === 1
            ? t('step1.title')
            : step === 2
              ? t('step2.title')
              : t('step3.title')}
        </h2>
      </div>

      {/* Step content */}
      {step === 1 ? (
        <Step1Context
          context={context}
          currency={contract.data!.currency}
          onChange={(patch) => setContext((prev) => ({ ...prev, ...patch }))}
          onNext={handleStep1Next}
          errors={step1Errors}
        />
      ) : step === 2 ? (
        <Step2Items
          items={ipa.data!.items}
          rows={rows}
          nodeMap={nodeMap}
          currency={contract.data!.currency}
          onRowChange={updateRow}
          onBack={() => setStep(1)}
          onNext={handleStep2Next}
          errors={step2Errors}
        />
      ) : (
        <Step3Review
          context={context}
          rows={rows}
          items={ipa.data!.items}
          retentionTerms={contract.data!.retentionTerms}
          advanceTerms={contract.data!.advanceTerms}
          currency={contract.data!.currency}
          adHocDeductions={adHocDeductions}
          onAdHocChange={updateAdHoc}
          onAdHocAdd={addAdHoc}
          onAdHocRemove={removeAdHoc}
          onBack={() => setStep(isRejected ? 1 : 2)}
          onIssue={handleIssue}
          isPending={issue.isPending}
          errorMessage={issueError}
        />
      )}
    </div>
  );
}

