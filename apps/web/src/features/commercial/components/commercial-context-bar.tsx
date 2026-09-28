'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ellipsis } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import type { CommercialWorkspaceResponse } from '@erp/types';
import {
  Button,
  ContextBar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  MoneyDisplay,
  StatusPill,
  cn,
  useToast,
} from '@erp/ui';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { ApiError } from '@/lib/api-client';
import { statusTone } from '@/lib/status-registry';
import { useReopenContract } from '@/features/contracts/hooks/use-contracts';

import { getClientStatement } from '../api/commercial-workspace-api';
import { commercialKeys } from '../hooks/use-commercial';
import { statementToCsv, downloadTextFile } from '../lib/client-statement';

/**
 * The contract's bar: which contract, its state, and the five figures the tab is about. No
 * primary — the next step lives in Billing's To do, where its reason is. The kebab holds the
 * contract-level commands, each rendered only when the server says the caller may run it.
 */
export function CommercialContextBar({
  projectId,
  workspace,
}: {
  projectId: string;
  workspace: CommercialWorkspaceResponse;
}) {
  const t = useTranslations('commercial.bar');
  const tStatus = useTranslations('commercial.contractStatus');
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const contract = workspace.contract!;
  const { facts, capabilities, financialsVisible } = workspace;
  const [reopenOpen, setReopenOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const reopen = useReopenContract(contract.id);

  const money = (value: string | null, danger = false) => {
    const positive = value !== null && Number(value) > 0;
    return (
      <MoneyDisplay
        value={value}
        hidden={!financialsVisible}
        hiddenLabel={t('hidden')}
        unavailableLabel={t('unknown')}
        className={cn(danger && positive && 'text-danger')}
      />
    );
  };

  const exportStatement = async () => {
    setExporting(true);
    try {
      const statement = await getClientStatement(projectId);
      downloadTextFile(`statement-${contract.contractNumber}.csv`, statementToCsv(statement, (key) => t(`statement.${key}`)));
    } catch (error) {
      toast({ tone: 'error', title: errorText(error, t('statement.failed')) });
    } finally {
      setExporting(false);
    }
  };

  const hasMenu = capabilities.canBill || capabilities.canExportStatement || capabilities.canReopenContract;

  return (
    <>
      <ContextBar
        headingId="commercial-contract-title"
        title={t('title', { ref: contract.shortRef })}
        status={<StatusPill tone={statusTone(contract.status, 'contract')}>{tStatus(contract.status)}</StatusPill>}
        metrics={[
          { key: 'value', label: t('contractValue'), value: money(facts.contractValue) },
          { key: 'invoiced', label: t('invoiced'), value: money(facts.invoiced) },
          { key: 'collected', label: t('collected'), value: money(facts.collected) },
          { key: 'outstanding', label: t('outstanding'), value: money(facts.outstanding) },
          { key: 'overdue', label: t('overdue'), value: money(facts.overdue, true) },
        ]}
        menu={
          hasMenu ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label={t('more')} title={t('more')}>
                  <Ellipsis size={18} aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {capabilities.canBill ? (
                  // Separate charges are raised where extra scope is: the BOQ's who-pays decision.
                  <DropdownMenuItem onSelect={() => router.push(`/projects/${projectId}/boq?extraWork=1`)}>
                    {t('newSeparateCharge')}
                  </DropdownMenuItem>
                ) : null}
                {capabilities.canExportStatement ? (
                  <DropdownMenuItem disabled={exporting} onSelect={() => void exportStatement()}>
                    {t('exportStatement')}
                  </DropdownMenuItem>
                ) : null}
                {capabilities.canReopenContract ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem destructive onSelect={() => setReopenOpen(true)}>
                      {t('reopen')}
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null
        }
      />

      {reopenOpen ? (
        <ConfirmActionDialog
          title={t('reopenTitle', { number: contract.contractNumber })}
          description={t('reopenBody')}
          confirmLabel={t('reopenConfirm')}
          destructive
          reason={{ required: true, maxLength: 500 }}
          isPending={reopen.isPending}
          errorMessage={reopen.isError ? errorText(reopen.error, t('reopenFailed')) : undefined}
          onConfirm={(reason) =>
            reopen.mutate(reason, {
              onSuccess: async () => {
                setReopenOpen(false);
                await queryClient.invalidateQueries({ queryKey: commercialKeys.all(projectId) });
              },
            })
          }
          onDismiss={() => {
            reopen.reset();
            setReopenOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.messages.length > 0) return error.messages[0]!;
  return fallback;
}
