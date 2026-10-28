'use client';

import { useTranslations } from 'next-intl';
import { Button, Notice } from '@erp/ui';

/**
 * Step 7 — shown in place of a form once it is queued on the phone. The form stays where it is:
 * with no signal the next page may not open, so the confirmation must not depend on loading one.
 * "Site home" is a plain link (a full page load), which the service worker answers from its copy.
 */
export function KeptOnPhone({ onAnother }: { onAnother?: () => void }) {
  const t = useTranslations('procurement.site');
  return (
    <div className="mx-auto max-w-xl space-y-4 py-6">
      <Notice tone="success" title={t('keptTitle')}>
        {t('keptBody')}
      </Notice>
      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <a href="/site">{t('keptHome')}</a>
        </Button>
        {onAnother ? (
          <Button type="button" variant="outline" onClick={onAnother}>
            {t('keptAnother')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
