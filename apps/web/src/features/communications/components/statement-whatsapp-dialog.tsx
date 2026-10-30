'use client';

import { useQueryClient } from '@tanstack/react-query';

import {
  getStatementWhatsAppPreview,
  getSupplierStatementWhatsAppPreview,
  sendStatementWhatsApp,
  sendSupplierStatementWhatsApp,
} from '../api';
import { communicationKeys } from '../hooks';
import { WhatsAppSendDialog } from './whatsapp-send-dialog';

/**
 * {@link WhatsAppSendDialog} bound to a statement for a period: a client's (ST-6) or, with
 * `supplierId`, our record of a supplier's account (SS-3).
 */
export function StatementWhatsAppDialog({
  open,
  onClose,
  clientId,
  supplierId,
  from,
  to,
  title,
  subtitle,
}: {
  open: boolean;
  onClose: () => void;
  clientId?: string;
  supplierId?: string;
  from: string;
  to: string;
  title: string;
  subtitle?: string;
}) {
  const queryClient = useQueryClient();
  const supplier = Boolean(supplierId);
  const id = (supplierId ?? clientId)!;
  const resource = supplier ? 'supplier_statement' : 'client_statement';
  return (
    <WhatsAppSendDialog
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      previewQueryKey={['whatsapp-preview', resource, id, from, to]}
      loadPreview={() => (supplier ? getSupplierStatementWhatsAppPreview(id, from, to) : getStatementWhatsAppPreview(id, from, to))}
      send={(body) => (supplier ? sendSupplierStatementWhatsApp(id, from, to, body) : sendStatementWhatsApp(id, from, to, body))}
      onSent={() => void queryClient.invalidateQueries({ queryKey: communicationKeys.resource(resource, id) })}
    />
  );
}
