'use client';

import { useTranslations } from 'next-intl';
import { Alert, Button } from '@erp/ui';

/**
 * The one "could not load" state (ADR-047 §3a): what failed, and Try again when the caller can
 * refetch. A failed load never leaves the reader with a dead end, and never with an empty screen
 * that reads as "nothing here".
 */
export function LoadError({
  message,
  onRetry,
  className,
}: {
  /** Already translated: "The invoice could not be loaded." */
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  const t = useTranslations('common.emptyState');
  return (
    <Alert variant="error" messages={[message]} className={className}>
      {onRetry ? (
        <div className="mt-3">
          <Button variant="outline" size="sm" onClick={onRetry}>
            {t('tryAgain')}
          </Button>
        </div>
      ) : null}
    </Alert>
  );
}
