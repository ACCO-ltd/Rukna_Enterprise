'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Badge, Button, Label, Select, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableScroll } from '@erp/ui';

import { useWorkflowDefinition } from '../hooks/use-workflow-definition';
import { WorkflowTransactionType } from '../types';

const TRANSACTION_TYPES = Object.values(WorkflowTransactionType);

export function WorkflowDefinitionViewer() {
  const t = useTranslations('platform.workflows');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const [selected, setSelected] = useState<WorkflowTransactionType>(WorkflowTransactionType.IPC);
  const { data: definition, isPending, isError, refetch, isFetching } = useWorkflowDefinition(selected);

  return (
    <div className="space-y-6">
      {/* Transaction type selector */}
      <div className="max-w-xs">
        <Label htmlFor="wf-type">{t('viewer.typeLabel')}</Label>
        <Select
          id="wf-type"
          className="mt-1"
          value={selected}
          onChange={(e) => setSelected(e.target.value as WorkflowTransactionType)}
        >
          {TRANSACTION_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`viewer.types.${type}`)}
            </option>
          ))}
        </Select>
      </div>

      {/* Definition panel */}
      {isPending ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">{tCommon('loading')}</span>
          <div className="h-48 animate-pulse rounded-lg border border-border bg-muted" aria-hidden="true" />
        </div>
      ) : isError ? (
        <Alert variant="error" messages={[t('viewer.loadFailed')]}>
          <div className="mt-3">
            <Button variant="outline" size="sm" onClick={() => { void refetch(); }} disabled={isFetching}>
              {t('viewer.retry')}
            </Button>
          </div>
        </Alert>
      ) : definition === null ? (
        <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-10 text-center">
          <p className="text-sm font-medium text-foreground">{t('viewer.notConfigured')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('viewer.notConfiguredHint')}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Definition header */}
          <div className="rounded-lg border border-border bg-surface p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs text-muted-foreground">{t('viewer.definitionName')}</p>
                <p className="mt-0.5 text-base font-semibold text-foreground">
                  {locale === 'ar' && definition.nameAr ? definition.nameAr : definition.name}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge tone={definition.isActive ? 'live' : 'neutral'}>
                  {definition.isActive ? t('viewer.active') : t('viewer.inactive')}
                </Badge>
                {definition.requiresCeoConfirmation ? (
                  <Badge tone='warning'>{t('viewer.requiresCeo')}</Badge>
                ) : null}
              </div>
            </div>
          </div>

          {/* Conditions */}
          <section aria-labelledby="conditions-heading">
            <h2
              id="conditions-heading"
              className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground"
            >
              {t('viewer.conditions')}
            </h2>
            {definition.conditions.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('viewer.noConditions')}</p>
            ) : (
              <TableScroll aria-label={t('viewer.conditions')}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('viewer.colField')}</TableHead>
                      <TableHead>{t('viewer.colOperator')}</TableHead>
                      <TableHead>{t('viewer.colValue')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {definition.conditions.map((cond) => (
                      <TableRow key={cond.id}>
                        <TableCell className="font-mono text-xs">{cond.field}</TableCell>
                        <TableCell className="font-mono text-xs">{cond.operator}</TableCell>
                        <TableCell>
                          {cond.value}
                          {cond.currencyCode ? (
                            <span className="ms-1 text-xs text-muted-foreground">{cond.currencyCode}</span>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableScroll>
            )}
          </section>

          {/* Steps */}
          <section aria-labelledby="steps-heading">
            <h2
              id="steps-heading"
              className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground"
            >
              {t('viewer.steps')}
            </h2>
            {definition.steps.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('viewer.noSteps')}</p>
            ) : (
              <TableScroll aria-label={t('viewer.steps')}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('viewer.colStep')}</TableHead>
                      <TableHead>{t('viewer.colRole')}</TableHead>
                      <TableHead>{t('viewer.colOptional')}</TableHead>
                      <TableHead>{t('viewer.colEscalate')}</TableHead>
                      <TableHead>{t('viewer.colNotify')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {definition.steps
                      .slice()
                      .sort((a, b) => a.stepOrder - b.stepOrder)
                      .map((step) => (
                        <TableRow key={step.id}>
                          <TableCell className="tabular-nums font-medium">{step.stepOrder}</TableCell>
                          <TableCell className="font-mono text-xs">{step.roleRequired}</TableCell>
                          <TableCell>
                            {step.isOptional ? (
                              <Badge tone="neutral">{t('viewer.optional')}</Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">
                            {step.escalateAfterHours != null
                              ? t('viewer.hours', { hours: step.escalateAfterHours })
                              : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell>
                            {step.notifyRoles.length > 0 ? (
                              <span className="font-mono text-xs">{step.notifyRoles.join(', ')}</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </TableScroll>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
