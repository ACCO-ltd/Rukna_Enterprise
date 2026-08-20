'use client';

/**
 * The governance configuration an organization is subject to: every trigger binding, and whether
 * it is switched on. This is the "what is actually gated" view the definition viewer does not
 * give — a definition can exist while no binding routes to it, in which case nothing gates.
 *
 * Read-only by design. Activating a binding switches on governance whose chains ACCO has not yet
 * confirmed (steps are seeded as placeholders, ADR-007), so there is intentionally no toggle
 * here: the read endpoint exists, the write one does not, and this panel says so rather than
 * offering a control the platform withholds on purpose.
 */

import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';

import { useWorkflowBindings } from '../hooks/use-workflow-bindings';
import type { WorkflowTriggerBinding } from '../types';

export function GovernanceBindingsPanel() {
  const t = useTranslations('platform.workflows.bindings');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const { data, isPending, isError } = useWorkflowBindings();

  return (
    <section aria-labelledby="governance-bindings-heading" className="space-y-4">
      <div>
        <h2 id="governance-bindings-heading" className="text-base font-semibold text-foreground">
          {t('heading')}
        </h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">{t('subheading')}</p>
      </div>

      {isPending ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">{tCommon('loading')}</span>
          <div
            className="h-40 animate-pulse rounded-panel border border-border bg-muted"
            aria-hidden="true"
          />
        </div>
      ) : isError ? (
        <Alert variant="error" messages={[t('loadFailed')]} />
      ) : data.length === 0 ? (
        <div className="rounded-panel border border-dashed border-border bg-surface px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        </div>
      ) : (
        <TableScroll aria-label={t('heading')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('colTransition')}</TableHead>
                <TableHead>{t('colChain')}</TableHead>
                <TableHead>{t('colScope')}</TableHead>
                <TableHead className="text-end">{t('colPriority')}</TableHead>
                <TableHead>{t('colStatus')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((binding) => (
                <BindingRow key={binding.id} binding={binding} locale={locale} />
              ))}
            </TableBody>
          </Table>
        </TableScroll>
      )}
    </section>
  );
}

function BindingRow({
  binding,
  locale,
}: {
  binding: WorkflowTriggerBinding;
  locale: 'en' | 'ar';
}) {
  const t = useTranslations('platform.workflows.bindings');

  const chainName = binding.definition.name;
  const stepCount = binding.definition.steps.length;

  return (
    <TableRow>
      {/* Transition — entity, and the state change (or "document" trigger). */}
      <TableCell>
        <div className="font-medium text-foreground">{binding.entityType}</div>
        <div className="mt-0.5 font-mono text-xs text-muted-foreground">
          {binding.triggerKind === 'STATE_TRANSITION'
            ? `${binding.fromState ?? t('anyState')} → ${binding.toState ?? t('anyState')}`
            : t('document')}
        </div>
      </TableCell>

      {/* Approval chain — the definition it routes to, and how many steps. */}
      <TableCell>
        <div className="text-sm text-foreground">{chainName}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {t('steps', { count: stepCount })}
        </div>
      </TableCell>

      {/* Scope — org-specific vs a tenant default. */}
      <TableCell>
        <span className="text-sm text-muted-foreground">
          {binding.organizationId ? t('scopeOrg') : t('scopeTenant')}
        </span>
      </TableCell>

      <TableCell className="text-end tabular-nums">{binding.priority}</TableCell>

      {/* Status — the one fact this whole view exists to show. */}
      <TableCell>
        <Badge tone={binding.isActive ? 'live' : 'neutral'}>
          {binding.isActive ? t('active') : t('inactive')}
        </Badge>
      </TableCell>
    </TableRow>
  );
}
