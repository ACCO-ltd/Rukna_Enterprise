'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button } from '@erp/ui';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { lifecycleErrorKey } from '@/features/lifecycle/lifecycle-error';

import { getContractActions, requiresConfirmation, type ContractCommand } from '../contract-actions';
import {
  useAdvanceContract,
  useCancelContract,
  useTerminateContract,
} from '../hooks/use-contracts';
import type { ContractDetail } from '../types';

/** Which dialog is open, if any. */
type Pending = { kind: 'advance'; command: ContractCommand } | { kind: 'cancel' } | { kind: 'terminate' } | null;

export function ContractActionsPanel({ contract }: { contract: ContractDetail }) {
  const t = useTranslations('platform.contracts.actions');
  const tDetail = useTranslations('platform.contracts.detail');
  const tPlatform = useTranslations('platform');

  const advance = useAdvanceContract(contract.id);
  const cancel = useCancelContract(contract.id);
  const terminate = useTerminateContract(contract.id);

  const [pending, setPending] = useState<Pending>(null);

  const actions = getContractActions(contract);
  const active = pending?.kind === 'cancel' ? cancel : pending?.kind === 'terminate' ? terminate : advance;

  /**
   * The server's own explanation is preferred when it sent one — for a stale status it
   * says exactly what it expected, which beats anything generic. Otherwise the message is
   * chosen by failure kind, so a missing approval workflow never reads as "try again".
   */
  const failureMessage = active.failure
    ? active.failure.kind === 'invalid-transition' && active.failure.serverMessage
      ? active.failure.serverMessage
      : tPlatform(lifecycleErrorKey(active.failure.kind))
    : undefined;

  const run = (onDone: () => void) => {
    if (pending?.kind === 'advance') {
      advance.mutate(pending.command, { onSuccess: onDone });
    }
  };

  const close = () => {
    advance.reset();
    cancel.reset();
    terminate.reset();
    setPending(null);
  };

  const hasAnyAction = actions.advance || actions.canCancel || actions.canTerminate;

  return (
    <div className="space-y-3">
      {/* A contract sitting in ACTIVE has no button of its own, and the reason is not
          guessable: it is waiting on the PROJECT to record practical completion. Saying so
          beats leaving someone hunting for a control that does not exist. */}
      {actions.awaitingPracticalCompletion ? (
        <Alert variant="info" messages={[tDetail('awaitingPc')]} />
      ) : null}

      {hasAnyAction ? (
        <div className="flex flex-wrap gap-2">
          {actions.advance ? (
            <Button
              onClick={() => {
                const command = actions.advance!;
                if (requiresConfirmation(command)) setPending({ kind: 'advance', command });
                else advance.mutate(command);
              }}
              disabled={advance.isPending}
            >
              {t(actions.advance)}
            </Button>
          ) : null}

          {actions.canCancel ? (
            <Button
              variant="outline"
              onClick={() => {
                setPending({ kind: 'cancel' });
              }}
            >
              {t('cancel')}
            </Button>
          ) : null}

          {actions.canTerminate ? (
            <Button
              variant="destructive"
              onClick={() => {
                setPending({ kind: 'terminate' });
              }}
            >
              {t('terminate')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* A command that fires without a dialog still has to report failure somewhere. */}
      {!pending && failureMessage ? <Alert variant="error" messages={[failureMessage]} /> : null}

      {pending?.kind === 'advance' ? (
        <ConfirmActionDialog
          title={pending.command === 'execute' ? t('executeTitle') : t('closeTitle')}
          description={pending.command === 'execute' ? t('executeBody') : t('closeBody')}
          confirmLabel={t(pending.command)}
          isPending={advance.isPending}
          errorMessage={failureMessage}
          onConfirm={() => {
            run(close);
          }}
          onDismiss={close}
        />
      ) : null}

      {pending?.kind === 'cancel' ? (
        <ConfirmActionDialog
          title={t('cancelTitle')}
          description={t('cancelBody')}
          confirmLabel={t('cancel')}
          // The API requires a reason (@IsNotEmpty, max 500) and then discards it —
          // `void reason` in contract.service.ts. The hint says so rather than implying an
          // audit trail that does not exist yet.
          reason={{ required: true, label: t('cancelReason'), hint: t('reasonNotStored'), maxLength: 500 }}
          isPending={cancel.isPending}
          errorMessage={failureMessage}
          onConfirm={(reason) => {
            cancel.mutate(reason, { onSuccess: close });
          }}
          onDismiss={close}
        />
      ) : null}

      {pending?.kind === 'terminate' ? (
        <ConfirmActionDialog
          title={t('terminateTitle')}
          description={t('terminateBody')}
          confirmLabel={t('terminate')}
          reason={{
            required: true,
            label: t('terminateReason'),
            hint: t('reasonNotStored'),
            maxLength: 500,
          }}
          isPending={terminate.isPending}
          errorMessage={failureMessage}
          onConfirm={(reason) => {
            terminate.mutate(reason, { onSuccess: close });
          }}
          onDismiss={close}
        />
      ) : null}
    </div>
  );
}
