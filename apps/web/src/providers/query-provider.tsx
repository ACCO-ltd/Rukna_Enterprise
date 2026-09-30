'use client';

import { useEffect, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useTranslations } from 'next-intl';
import { SuccessDialog, useToast } from '@erp/ui';

import {
  flashRowId,
  markRowSaved,
  resolveMessage,
  type FeedbackMessage,
} from '@/lib/mutation-feedback';
import { makeQueryClient } from '@/lib/query-client';

/** Long enough for a closing FormDialog's exit animation (--motion-exit / --motion-enter). */
const SUCCESS_DIALOG_DELAY_MS = 200;

interface OpenSuccess {
  title: string;
  description?: string;
}

/**
 * The query client, plus the feedback every successful command gets (`mutation-feedback.ts`):
 * a toast, or — for a milestone — the success dialog, and a tint on the saved row.
 *
 * Mounted under `ToastProvider` (see the root layout), whose `toast` it calls.
 */
export function QueryProvider({
  children,
  createClient = makeQueryClient,
}: {
  children: React.ReactNode;
  /** Tests pass a no-retry client; the app uses the default. */
  createClient?: typeof makeQueryClient;
}) {
  const { toast } = useToast();
  const t = useTranslations();
  const tCommon = useTranslations('common.feedback');
  // Content and open state are kept apart so the dialog keeps its heading while it fades out.
  const [success, setSuccess] = useState<OpenSuccess | null>(null);
  const [successOpen, setSuccessOpen] = useState(false);

  const [queryClient] = useState(() => createClient());

  // Every finished mutation passes through the cache; the ones that carry feedback `meta` get
  // it here. A cache subscription (not `MutationCache.onSuccess`) because the `success` action
  // is dispatched after the hook's own `onSuccess` — its invalidation is already under way when
  // the confirmation appears — and because it re-binds cleanly to the current toast/translator.
  useEffect(() => {
    return queryClient.getMutationCache().subscribe((event) => {
      if (event.type !== 'updated' || event.action.type !== 'success') return;
      const meta = event.mutation.options.meta;
      if (!meta) return;
      const data = event.action.data;
      const variables = event.mutation.state.variables;

      // TanStack dispatches `success` inside the mutation's own try: a throw here would turn a
      // command the server already committed into an error — and invite a duplicating retry.
      // Feedback is decoration; it must never fail the command.
      try {
        const text = (message: FeedbackMessage) => {
          const { key, values } = resolveMessage(message, data, variables);
          return t(key, values);
        };

        const dialog = meta.successDialog;
        if (dialog && (!dialog.when || dialog.when(data, variables))) {
          const content = {
            title: text(dialog.title),
            description: dialog.description ? text(dialog.description) : undefined,
          };
          // Opened after the command's own dialog has finished closing: two Radix modals swapping
          // in one commit can leave the page's pointer lock and focus return tangled.
          window.setTimeout(() => {
            setSuccess(content);
            setSuccessOpen(true);
          }, SUCCESS_DIALOG_DELAY_MS);
        } else if (meta.successToast) {
          toast({ title: text(meta.successToast), tone: 'success' });
        } else {
          return;
        }

        const id = flashRowId(meta, data, variables);
        if (id) markRowSaved(id);
      } catch (error) {
        console.error('Mutation feedback failed; the command itself succeeded.', error);
      }
    });
  }, [queryClient, toast, t]);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <SuccessDialog
        open={successOpen}
        onOpenChange={setSuccessOpen}
        title={success?.title ?? ''}
        description={success?.description}
        doneLabel={tCommon('done')}
        closeLabel={tCommon('close')}
      />
      {process.env.NODE_ENV === 'development' && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
