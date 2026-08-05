'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Alert, Button } from '@erp/ui';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { lifecycleErrorKey } from '@/features/lifecycle/lifecycle-error';
import { IpaStatus } from '@erp/types';
import { useIpcs } from '@/features/ipc/hooks/use-ipc';

import { useCancelIpa, useIpaCommand } from '../hooks/use-ipa';
import {
  getIpaActions,
  ipaCommandNeedsConfirmation,
  isRegressiveCommand,
  isStuckAfterReturn,
  type IpaCommand,
} from '../ipa-actions';
import type { IpaDetail } from '../types';

type Pending = { kind: 'command'; command: IpaCommand } | { kind: 'cancel' } | null;

export function IpaActionsPanel({ ipa, contractId }: { ipa: IpaDetail; contractId: string }) {
  const t = useTranslations('platform.ipa.actions');
  const tDetail = useTranslations('platform.ipa.detail');
  const tPlatform = useTranslations('platform');
  const tIpc = useTranslations('platform.ipc.wizard');

  const ipcs = useIpcs(ipa.id);
  const hasEffectiveCert = ipcs.data?.some((c) => c.isEffective) ?? false;

  const run = useIpaCommand(ipa.id);
  const cancel = useCancelIpa(ipa.id);
  const [pending, setPending] = useState<Pending>(null);

  const actions = getIpaActions(ipa);
  const active = pending?.kind === 'cancel' ? cancel : run;

  const failureMessage = active.failure
    ? active.failure.kind === 'invalid-transition' && active.failure.serverMessage
      ? active.failure.serverMessage
      : tPlatform(lifecycleErrorKey(active.failure.kind))
    : undefined;

  const close = () => {
    run.reset();
    cancel.reset();
    setPending(null);
  };

  const confirmCopy = (command: IpaCommand) =>
    command === 'submit'
      ? { title: t('submitTitle'), body: t('submitBody') }
      : { title: t('returnTitle'), body: t('returnBody') };

  return (
    <div className="space-y-3">
      {/* Three states worth explaining rather than leaving the user to infer from absent
          buttons: frozen-but-not-final, final, and the returned-for-revision dead end. */}
      {!actions.canEditLines && !actions.isFinal ? (
        <Alert variant="info" messages={[tDetail('frozenHint')]} />
      ) : null}
      {actions.isFinal ? <Alert variant="info" messages={[tDetail('finalHint')]} /> : null}

      {/* Certificate CTA — adapts based on whether an effective cert already exists */}
      {ipa.status === IpaStatus.SUBMITTED ? (
        <div>
          <Button asChild>
            <Link href={`/contracts/${contractId}/applications/${ipa.id}/certificates/new`}>
              {hasEffectiveCert ? tIpc('wizard.supersedeCta') : tIpc('wizard.issueCta')}
            </Link>
          </Button>
        </div>
      ) : null}
      {/* Editable with nowhere to go. Without this the screen offers a full set of line
          controls and no way to submit what they produce, which reads as a broken page
          rather than a missing endpoint. */}
      {isStuckAfterReturn(ipa.status) ? (
        <Alert variant="warning" messages={[tDetail('stuckHint')]} />
      ) : null}

      {actions.commands.length > 0 || actions.canCancel ? (
        <div className="flex flex-wrap gap-2">
          {actions.commands.map((command, index) => (
            <Button
              key={command}
              // The first command in the list is the expected outcome; a regressive one
              // never takes the primary style even when it is the only command offered.
              variant={
                isRegressiveCommand(command) ? 'outline' : index === 0 ? 'default' : 'outline'
              }
              onClick={() => {
                if (ipaCommandNeedsConfirmation(command)) setPending({ kind: 'command', command });
                else run.mutate(command);
              }}
              disabled={run.isPending}
            >
              {t(command)}
            </Button>
          ))}

          {actions.canCancel ? (
            <Button
              variant="ghost"
              onClick={() => {
                setPending({ kind: 'cancel' });
              }}
            >
              {t('cancel')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* Approving is the step that assigns the number the client will see. It fires
          without a dialog, so the consequence is stated beside the button instead. */}
      {actions.commands.includes('approve-for-submission') ? (
        <p className="text-xs text-muted-foreground">{t('approveHint')}</p>
      ) : null}

      {!pending && failureMessage ? <Alert variant="error" messages={[failureMessage]} /> : null}

      {pending?.kind === 'command' ? (
        <ConfirmActionDialog
          title={confirmCopy(pending.command).title}
          description={confirmCopy(pending.command).body}
          confirmLabel={t(pending.command)}
          isPending={run.isPending}
          errorMessage={failureMessage}
          onConfirm={() => {
            run.mutate(pending.command, { onSuccess: close });
          }}
          onDismiss={close}
        />
      ) : null}

      {pending?.kind === 'cancel' ? (
        <ConfirmActionDialog
          title={t('cancelTitle')}
          description={t('cancelBody')}
          confirmLabel={t('cancel')}
          isPending={cancel.isPending}
          errorMessage={failureMessage}
          onConfirm={() => {
            cancel.mutate(undefined, { onSuccess: close });
          }}
          onDismiss={close}
        />
      ) : null}
    </div>
  );
}
