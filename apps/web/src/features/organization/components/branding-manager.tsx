'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, FormField, Input, Textarea, ViewSwitcher } from '@erp/ui';
import type { OrganizationDto } from '@erp/types';

import { usePermissions } from '@/features/auth/permissions/can';
import { getFileDownloadUrl } from '@/features/files/api/files-api';
import { useFileUpload } from '@/features/files/hooks/use-file-upload';
import { ApiError } from '@/lib/api-client';

import { useOrganization, useUpdateOrganizationBranding } from '../hooks/use-organization';

const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * Invoice branding settings (Commercial round-3): logo, legal address, tax ID, brand color,
 * footer note, and which of the two generated-invoice layouts to use.
 *
 * Deliberately just these fields, not a general "Organization settings" screen — a broader
 * settings epic (timezone, fiscal year, numbering) was speculatively stubbed in
 * `organization-settings.policy.ts` but never wired up; this screen exists to fix one thing
 * ("Generate invoice" produced a document with no header/footer identity at all), not to build
 * that larger, differently-scoped feature.
 */
export function BrandingManager() {
  const t = useTranslations('platform.branding');
  const tCommon = useTranslations('common');
  const { can } = usePermissions();
  const canManage = can('manage:organization');

  const { data: org, isPending, isError, refetch } = useOrganization();

  if (isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
        <div
          className="h-64 animate-pulse rounded-panel border border-border bg-muted"
          aria-hidden="true"
        />
      </div>
    );
  }

  if (isError || !org) {
    return (
      <Alert variant="error" messages={[t('loadFailed')]}>
        <div className="mt-3">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            {t('retry')}
          </Button>
        </div>
      </Alert>
    );
  }

  if (!canManage) {
    return <p className="text-body-sm text-muted-foreground">{t('noPermission')}</p>;
  }

  // Mounted only once `org` is loaded, so every field below seeds itself straight from it via a
  // lazy useState initializer — no effect needed to copy query data into local state.
  return <BrandingForm org={org} />;
}

function BrandingForm({ org }: { org: OrganizationDto }) {
  const t = useTranslations('platform.branding');
  const tCommon = useTranslations('common');
  const update = useUpdateOrganizationBranding();
  const upload = useFileUpload();

  const [legalAddress, setLegalAddress] = useState(org.legalAddress ?? '');
  const [taxRegistrationNumber, setTaxRegistrationNumber] = useState(
    org.taxRegistrationNumber ?? '',
  );
  const [brandColorHex, setBrandColorHex] = useState(org.brandColorHex ?? '');
  const [invoiceFooterNote, setInvoiceFooterNote] = useState(org.invoiceFooterNote ?? '');
  const [invoiceTemplate, setInvoiceTemplate] = useState<'STANDARD' | 'COMPACT'>(
    org.invoiceTemplate === 'COMPACT' ? 'COMPACT' : 'STANDARD',
  );
  const [logoFileId, setLogoFileId] = useState(org.logoFileId);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);

  // The signed download URL is short-lived (~15 min), so it is fetched fresh whenever the bound
  // file changes rather than stored anywhere. While `logoFileId` is null there is nothing to
  // fetch, and `logoPreviewUrl` simply stays whatever it last was — the render below only shows
  // it when a logo is actually set, so a stale value can never display for the wrong file.
  useEffect(() => {
    if (!logoFileId) return;
    let cancelled = false;
    getFileDownloadUrl(logoFileId)
      .then((res) => {
        if (!cancelled) setLogoPreviewUrl(res.url);
      })
      .catch(() => {
        if (!cancelled) setLogoPreviewUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [logoFileId]);

  async function onLogoSelected(file: File) {
    setLogoError(null);
    if (!file.type.startsWith('image/')) {
      setLogoError(t('logoWrongType'));
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError(t('logoTooLarge'));
      return;
    }
    try {
      const fileId = await upload.mutateAsync(file);
      setLogoFileId(fileId);
    } catch {
      setLogoError(t('logoUploadFailed'));
    }
  }

  function onSave() {
    update.mutate({
      logoFileId,
      legalAddress: legalAddress.trim() || null,
      taxRegistrationNumber: taxRegistrationNumber.trim() || null,
      brandColorHex: brandColorHex.trim() || null,
      invoiceFooterNote: invoiceFooterNote.trim() || null,
      invoiceTemplate,
    });
  }

  const saveError =
    update.error instanceof ApiError && update.error.messages.length > 0
      ? update.error.message
      : update.isError
        ? t('saveFailed')
        : null;

  return (
    <div className="max-w-2xl space-y-6">
      <p className="text-body-sm text-muted-foreground">{t('intro')}</p>

      <div>
        <p className="mb-2 text-body-sm font-medium text-foreground">{t('logoLabel')}</p>
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-control border border-border bg-surface-subtle">
            {logoFileId && logoPreviewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not a remote/static asset
              <img src={logoPreviewUrl} alt="" className="h-full w-full object-contain" />
            ) : (
              <span className="text-micro text-muted-foreground">{t('noLogo')}</span>
            )}
          </div>
          <div>
            <input
              id="branding-logo"
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onLogoSelected(file);
                e.target.value = '';
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={upload.isPending}
              onClick={() => document.getElementById('branding-logo')?.click()}
            >
              {upload.isPending
                ? tCommon('loading')
                : logoFileId
                  ? t('replaceLogo')
                  : t('uploadLogo')}
            </Button>
            <p className="mt-1 text-caption text-muted-foreground">{t('logoHint')}</p>
            {logoError ? (
              <p className="mt-1 text-caption font-medium text-danger">{logoError}</p>
            ) : null}
          </div>
        </div>
      </div>

      <FormField htmlFor="branding-address" label={t('addressLabel')}>
        <Textarea
          id="branding-address"
          rows={2}
          value={legalAddress}
          onChange={(e) => setLegalAddress(e.target.value)}
          maxLength={2000}
        />
      </FormField>

      <FormField htmlFor="branding-tax" label={t('taxLabel')}>
        <Input
          id="branding-tax"
          value={taxRegistrationNumber}
          onChange={(e) => setTaxRegistrationNumber(e.target.value)}
          maxLength={100}
        />
      </FormField>

      <FormField htmlFor="branding-color" label={t('colorLabel')}>
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label={t('colorLabel')}
            value={HEX_COLOR.test(brandColorHex) ? brandColorHex : '#1E40AF'}
            onChange={(e) => setBrandColorHex(e.target.value)}
            className="h-control w-11 shrink-0 cursor-pointer rounded-control border border-border-strong bg-surface p-1"
          />
          <Input
            id="branding-color"
            value={brandColorHex}
            onChange={(e) => setBrandColorHex(e.target.value)}
            placeholder="#1E40AF"
            className="w-32 font-mono"
          />
        </div>
      </FormField>

      <FormField htmlFor="branding-footer" label={t('footerLabel')}>
        <Textarea
          id="branding-footer"
          rows={2}
          value={invoiceFooterNote}
          onChange={(e) => setInvoiceFooterNote(e.target.value)}
          maxLength={2000}
          placeholder={t('footerPlaceholder')}
        />
      </FormField>

      <div>
        <p className="mb-1.5 text-body-sm font-medium text-foreground">{t('templateLabel')}</p>
        <ViewSwitcher
          aria-label={t('templateLabel')}
          value={invoiceTemplate}
          onValueChange={(value) => setInvoiceTemplate(value === 'COMPACT' ? 'COMPACT' : 'STANDARD')}
          items={[
            { value: 'STANDARD', label: t('templateStandard') },
            { value: 'COMPACT', label: t('templateCompact') },
          ]}
        />
      </div>

      {saveError ? <Alert variant="error" messages={[saveError]} /> : null}

      <div>
        <Button type="button" onClick={onSave} disabled={update.isPending || upload.isPending}>
          {update.isPending ? tCommon('saving') : tCommon('save')}
        </Button>
        {update.isSuccess ? (
          <span className="ms-3 text-caption font-medium text-success">{t('saved')}</span>
        ) : null}
      </div>
    </div>
  );
}
