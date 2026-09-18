'use client';

import { useMemo, useState } from 'react';
import { CircleDollarSign, GitPullRequestArrow, Receipt } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  Input,
  Label,
  MoneyInput,
  RadioGroup,
  Select,
  Textarea,
  cn,
  type RadioOption,
} from '@erp/ui';

import { formatMoney } from '@/lib/format';

export type ClassifierRoute = 'ABSORB' | 'VARIATION' | 'SEPARATE';
type PricingMode = 'LUMP_SUM' | 'UNIT_RATE';

export interface BoqSectionOption {
  id: string;
  code: string;
  description: string;
}

export interface AddExtraWorkResult {
  route: ClassifierRoute;
  description: string;
  /** Normalized 2dp decimal string (CONST-BOQ-014). */
  amount: string;
  unit?: string;
  /** Which BOQ section to nest under. Absent = top level (VARIATION auto-creates a root container). */
  parentId?: string;
  /** VARIATION only — optional paper VO reference (≤120 chars). */
  clientApprovalReference?: string;
  /** VARIATION only — optional title for the created VO (≤255 chars). */
  variationTitle?: string;
}

/**
 * The full Add Extra Work form (Slice 2).
 *
 * Adds on top of the lean `BoqClassifierDrawer`:
 *   - Pricing mode toggle: lump sum OR rate × quantity (UI calc only — API receives `amount`)
 *   - BOQ parent section picker for ABSORB/SEPARATE (`parentId` on the line)
 *   - Variation title field (`variationTitle` on the DTO, VARIATION only)
 *   - Updated consequence language per UX spec
 *
 * Not integrated into the BOQ workspace yet — consumed via component tests until Slice 1 merges.
 * Fields omitted (no API support): client approval date, attachment, notes.
 */
export function AddExtraWorkDrawer({
  open,
  currency,
  contractId: _contractId,
  contingencyRemaining: _contingencyRemaining,
  contractValue,
  totalClientRevenue: _totalClientRevenue,
  absorbEnabled,
  variationEnabled,
  separateEnabled,
  boqSections,
  isPending,
  errorMessage,
  onSubmit,
  onClose,
}: {
  open: boolean;
  currency: string;
  /** Passed through to the caller via result; not used for display here. */
  contractId: string | null;
  /** Available but unused for display — ABSORB consequence shows entered amount, not remaining. */
  contingencyRemaining: string | null;
  contractValue: string | null;
  totalClientRevenue: string | null;
  absorbEnabled: boolean;
  /** VARIATION requires a signed contract — disable when none exists. */
  variationEnabled: boolean;
  separateEnabled: boolean;
  boqSections: ReadonlyArray<BoqSectionOption>;
  isPending: boolean;
  errorMessage?: string;
  onSubmit: (result: AddExtraWorkResult) => void;
  onClose: () => void;
}) {
  const t = useTranslations('platform.boq.addExtraWork');
  // Route names, taglines, details, CTAs, and unavailable note are shared with the classifier.
  const tClassifier = useTranslations('platform.boq.classifier');
  const locale = useLocale() as 'en' | 'ar';

  const [route, setRoute] = useState<ClassifierRoute | ''>('VARIATION');
  const [pricingMode, setPricingMode] = useState<PricingMode>('LUMP_SUM');
  const [description, setDescription] = useState('');
  const [lumpAmount, setLumpAmount] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unitRate, setUnitRate] = useState('');
  const [unit, setUnit] = useState('');
  const [parentId, setParentId] = useState('');
  const [clientApprovalReference, setClientApprovalReference] = useState('');
  const [variationTitle, setVariationTitle] = useState('');

  const money = (v: string | null): string | null => formatMoney(v, currency, locale);

  const computedAmount = useMemo(
    () => computeAmountFromMode(pricingMode, lumpAmount, quantity, unitRate),
    [pricingMode, lumpAmount, quantity, unitRate],
  );

  // VARIATION consequence: project the entered amount onto the live contract value.
  const variationProjection = useMemo(
    () => project(contractValue, computedAmount, 'add'),
    [contractValue, computedAmount],
  );

  // ABSORB/SEPARATE consequences show the entered amount directly — not a running total.
  const consequenceAmount = isPositive(computedAmount) ? money(normalize(computedAmount)) : null;

  const routeEnabled =
    (route === 'VARIATION' && variationEnabled) ||
    (route === 'ABSORB' && absorbEnabled) ||
    (route === 'SEPARATE' && separateEnabled);

  const canSubmit =
    route !== '' &&
    routeEnabled &&
    description.trim().length > 0 &&
    isPositive(computedAmount) &&
    !(route === 'VARIATION' && boqSections.length > 0 && !parentId);

  const cta =
    route === 'ABSORB'
      ? tClassifier('absorb.cta')
      : route === 'SEPARATE'
        ? tClassifier('separate.cta')
        : tClassifier('variation.cta');

  const pricingOptions: RadioOption<PricingMode>[] = [
    { value: 'LUMP_SUM', label: t('lumpSum') },
    { value: 'UNIT_RATE', label: t('unitRate') },
  ];

  const routeOptions: RadioOption<ClassifierRoute>[] = [
    {
      value: 'ABSORB',
      label: (
        <span className="inline-flex items-center gap-2">
          <CircleDollarSign size={15} aria-hidden="true" />
          {tClassifier('absorb.name')} — {tClassifier('absorb.tagline')}
        </span>
      ),
      description: (
        <RouteDetail
          detail={tClassifier('absorb.detail')}
          consequence={
            consequenceAmount ? t('absorb.consequence', { amount: consequenceAmount }) : null
          }
          disabledNote={!absorbEnabled ? tClassifier('unavailable') : undefined}
        />
      ),
      disabled: false,
    },
    {
      value: 'VARIATION',
      label: (
        <span className="inline-flex items-center gap-2">
          <GitPullRequestArrow size={15} aria-hidden="true" />
          {tClassifier('variation.name')} — {tClassifier('variation.tagline')}
        </span>
      ),
      description: (
        <RouteDetail
          detail={tClassifier('variation.detail')}
          consequence={
            contractValue && variationProjection
              ? t('variation.consequence', {
                  from: money(contractValue) ?? '',
                  to: money(variationProjection) ?? '',
                })
              : null
          }
          disabledNote={!variationEnabled ? tClassifier('unavailable') : undefined}
        />
      ),
    },
    {
      value: 'SEPARATE',
      label: (
        <span className="inline-flex items-center gap-2">
          <Receipt size={15} aria-hidden="true" />
          {tClassifier('separate.name')} — {tClassifier('separate.tagline')}
        </span>
      ),
      description: (
        <RouteDetail
          detail={tClassifier('separate.detail')}
          consequence={
            consequenceAmount ? t('separate.consequence', { amount: consequenceAmount }) : null
          }
          disabledNote={!separateEnabled ? tClassifier('unavailable') : undefined}
        />
      ),
    },
  ];

  function handleSubmit() {
    if (!route) return;
    const amt = normalize(computedAmount);
    const u = unit.trim();
    const pid = parentId || undefined;
    const ref = clientApprovalReference.trim();
    const title = variationTitle.trim();

    onSubmit({
      route,
      description: description.trim(),
      amount: amt,
      ...(u ? { unit: u } : {}),
      ...(pid ? { parentId: pid } : {}),
      ...(route === 'VARIATION' && ref ? { clientApprovalReference: ref } : {}),
      ...(route === 'VARIATION' && title ? { variationTitle: title } : {}),
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-xl">
        <DialogTitle>
          {t('title')}
          <span className="mt-0.5 block text-body-sm font-normal text-muted-foreground">
            {t('subtitle')}
          </span>
        </DialogTitle>

        <div className="space-y-4">
          {/* ── 1. Who pays? ─────────────────────────────────────── */}
          <RadioGroup
            name="who-pays"
            label={t('subtitle')}
            orientation="vertical"
            value={route}
            onChange={setRoute}
            options={routeOptions}
          />

          {/* ── 2. Description ───────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label htmlFor="aew-desc">{t('descriptionLabel')}</Label>
            <Textarea
              id="aew-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('descriptionPlaceholder')}
              maxLength={500}
              rows={2}
            />
          </div>

          {/* ── 3. Pricing ───────────────────────────────────────── */}
          <div className="space-y-3">
            <RadioGroup
              name="pricing-mode"
              label={t('pricingLabel')}
              value={pricingMode}
              onChange={setPricingMode}
              options={pricingOptions}
            />

            {pricingMode === 'LUMP_SUM' ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="aew-amount">{t('amountLabel', { currency })}</Label>
                  <MoneyInput id="aew-amount" value={lumpAmount} onValueChange={setLumpAmount} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="aew-unit">{t('unitLabel')}</Label>
                  <Input
                    id="aew-unit"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    maxLength={20}
                    placeholder="e.g. m³"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="aew-qty">{t('quantityLabel')}</Label>
                    <Input
                      id="aew-qty"
                      type="number"
                      min="0"
                      step="any"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="aew-unit">{t('unitLabel')}</Label>
                    <Input
                      id="aew-unit"
                      value={unit}
                      onChange={(e) => setUnit(e.target.value)}
                      maxLength={20}
                      placeholder="e.g. m³"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="aew-rate">{t('rateLabel', { currency })}</Label>
                  <MoneyInput id="aew-rate" value={unitRate} onValueChange={setUnitRate} />
                </div>
                {isPositive(computedAmount) ? (
                  <p className="text-body-sm font-medium tabular-nums text-foreground">
                    {t('computedAmount', { amount: money(normalize(computedAmount)) ?? '' })}
                  </p>
                ) : null}
              </div>
            )}
          </div>

          {/* ── 4. BOQ parent section — all routes ───────────────── */}
          {boqSections.length > 0 ? (
            <div className="space-y-1.5">
              <Label htmlFor="aew-parent">{t('parentSectionLabel')}</Label>
              <Select id="aew-parent" value={parentId} onChange={setParentId}>
                {/* VARIATION requires explicit section selection — "Top level" is not valid when
                    the BOQ has structure. ABSORB/SEPARATE may float. */}
                {route !== 'VARIATION' ? (
                  <option value="">{t('parentSectionNone')}</option>
                ) : (
                  <option value="">{t('parentSectionChoose')}</option>
                )}
                {boqSections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.code} — {section.description}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}

          {/* ── 5. VARIATION extras ──────────────────────────────── */}
          {route === 'VARIATION' ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="aew-vo-title">{t('variationTitleLabel')}</Label>
                <Input
                  id="aew-vo-title"
                  value={variationTitle}
                  onChange={(e) => setVariationTitle(e.target.value)}
                  maxLength={255}
                  placeholder={t('variationTitlePlaceholder')}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="aew-client-ref">{t('clientRefLabel')}</Label>
                <Input
                  id="aew-client-ref"
                  value={clientApprovalReference}
                  onChange={(e) => setClientApprovalReference(e.target.value)}
                  maxLength={120}
                  placeholder={t('clientRefPlaceholder')}
                />
              </div>
            </>
          ) : null}

          {errorMessage ? (
            <p className="text-body-sm text-danger" role="alert">
              {errorMessage}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            {t('cancel')}
          </Button>
          <Button disabled={!canSubmit || isPending} onClick={handleSubmit}>
            {cta}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function RouteDetail({
  detail,
  consequence,
  disabledNote,
}: {
  detail: string;
  consequence: string | null;
  disabledNote?: string;
}) {
  return (
    <span className="block space-y-1">
      <span className="block">{detail}</span>
      {consequence ? (
        <span className="block font-medium tabular-nums text-foreground">{consequence}</span>
      ) : null}
      {disabledNote ? (
        <span className={cn('block text-caption font-medium text-warning')}>{disabledNote}</span>
      ) : null}
    </span>
  );
}

// ─── Math helpers ─────────────────────────────────────────────────────────────

/**
 * Resolves the working amount from the current pricing mode. Returns '' when inputs are
 * insufficient (the CTA guard treats '' as not-positive and stays disabled).
 */
function computeAmountFromMode(
  mode: PricingMode,
  lumpAmount: string,
  qty: string,
  rate: string,
): string {
  if (mode === 'LUMP_SUM') return lumpAmount;
  const q = Number(qty);
  const r = Number(rate);
  if (!Number.isFinite(q) || q <= 0 || !Number.isFinite(r) || r <= 0) return '';
  // Integer-cent multiplication to avoid float drift on display.
  return (Math.round(q * r * 100) / 100).toFixed(2);
}

/**
 * Projects `base ± amount` in integer cents for the consequence preview.
 * Returns a 2dp string, or null when the base is withheld or the amount is not positive.
 */
function project(base: string | null, amount: string, op: 'add' | 'subtract'): string | null {
  if (!base || !isPositive(amount)) return null;
  const baseMinor = toMinor(base);
  const amtMinor = toMinor(amount);
  if (baseMinor === null || amtMinor === null) return null;
  const result = op === 'add' ? baseMinor + amtMinor : baseMinor - amtMinor;
  return (result / 100).toFixed(2);
}

function toMinor(value: string): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function isPositive(value: string): boolean {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function normalize(value: string): string {
  return (Math.round(Number(value) * 100) / 100).toFixed(2);
}
