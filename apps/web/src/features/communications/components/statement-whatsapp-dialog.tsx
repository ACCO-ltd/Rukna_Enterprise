'use client';

import { useQueryClient } from '@tanstack/react-query';

import { getStatementWhatsAppPreview, sendStatementWhatsApp } from '../api';
import { communicationKeys } from '../hooks';
import { WhatsAppSendDialog } from './whatsapp-send-dialog';

/** {@link WhatsAppSendDialog} bound to a client's statement for a period (ST-6). */
export function StatementWhatsAppDialog({
  open,
  onClose,
  clientId,
  from,
  to,
  title,
  subtitle,
}: {
  open: boolean;
  onClose: () => void;
  clientId: string;
  from: string;
  to: string;
  title: string;
  subtitle?: string;
}) {
  const queryClient = useQueryClient();
  return (
    <WhatsAppSendDialog
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      previewQueryKey={['whatsapp-preview', 'client_statement', clientId, from, to]}
      loadPreview={() => getStatementWhatsAppPreview(clientId, from, to)}
      send={(body) => sendStatementWhatsApp(clientId, from, to, body)}
      onSent={() => void queryClient.invalidateQueries({ queryKey: communicationKeys.resource('client_statement', clientId) })}
    />
  );
}
