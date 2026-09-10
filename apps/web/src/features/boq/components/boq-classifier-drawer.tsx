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
  cn,
  type RadioOption,
} from '@erp/ui';

import { formatMoney } from '@/lib/format';

/** The three who-pays routes (R5). */
export type ClassifierRoute = 'ABSORB' | 'VARIATION' | 'SEPARATE';

export interface ClassifierResult {
  route: ClassifierRoute;
  description: string;
  /** Decimal string (2dp), the amount of the extra work. */
  amount: string;
}

/**
 * The who-pays classifier (R11 concept — every design agreed on it). A decision-first chooser:
 * the reader picks who pays BEFORE the money moves, and each route previews its exact money
 * consequence from the read-model figures (no client re-summing — the previews add the entered
 * amount to a server-supplied base only for the arithmetic the user is about to authorise, and
 * label it as a projection).
 *
 * Route reachability (R11 backend reality):
 *  - VARIATION writes a DRAFT VO (reachable via the Commercial variations flow) — feedback + a
 *    pending row follow (H1). `onSubmit` is invoked.
 *  - ABSORB (add new ABSORBED scope) and SEPARATE (add a SEPARATE_CHARGE leaf) have service
 *    methods but NO committed HTTP route yet. When `absorbEnabled`/`separateEnabled` is false the
 *    route still previews its consequence but the CTA is disabled with an honest "not available
 *    yet" note — never a fake success.
 */
export function BoqClassifierDrawer({
  open,
  currency,
  contingencyRemaining,
  contractValue,
  totalClientRevenue,
  absorbEnabled,
  separateEnabled,
  isPending,
  errorMessage,
  onSubmit,
  onClose,
}: {
  open: boolean;
  currency: string;
  /** Live figures the previews project from. Null when withheld — the preview is then hidden. */
  contingencyRemaining: string | null;
  contractValue: string | null;
  totalClientRevenue: string | null;
  absorbEnabled: boolean;
  separateEnabled: boolean;
  isPending: boolean;
  errorMessage?: string;
  onSubmit: (result: ClassifierResult) => void;
  onClose: () => void;
}) {
  const t = useTranslations('platform.boq.classifier');
  const locale = useLocale() as 'en' | 'ar';

  const [route, setRoute] = useState<ClassifierRoute | ''>('VARIATION');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');

  const money = (v: string | null): string | null => formatMoney(v, currency, locale);

  // Projected consequences. Display-only integer-cent arithmetic on a server base + the entered
  // amount — the one sum the user is authorising, shown so cause→effect is legible. Never
  // persisted, never fed back as a total.
  const projections = useMemo(
    () => ({
      absorb: project(contingencyRemaining, amount, 'subtract'),
      variationTo: project(contractValue, amount, 'add'),
      revenueTo: project(totalClientRevenue, amount, 'add'),
    }),
    [contingencyRemaining, contractValue, totalClientRevenue, amount],
  );

  const options: RadioOption<ClassifierRoute>[] = [
    {
      value: 'ABSORB',
      label: (
        <span className="inline-flex items-center gap-2">
          <CircleDollarSign size={15} aria-hidden="true" />
          {t('absorb.name')} — {t('absorb.tagline')}
        </span>
      ),
      description: (
        <RouteDetail
          detail={t('absorb.detail')}
          consequence={
            contingencyRemaining && projections.absorb
              ? t('absorb.consequence', { amount: money(projections.absorb) ?? '' })
              : null
          }
          disabledNote={!absorbEnabled ? t('unavailable') : undefined}
        />
      ),
      disabled: false,
    },
    {
      value: 'VARIATION',
      label: (
        <span className="inline-flex items-center gap-2">
          <GitPullRequestArrow size={15} aria-hidden="true" />
          {t('variation.name')} — {t('variation.tagline')}
        </span>
      ),
      description: (
        <RouteDetail
          detail={t('variation.detail')}
          consequence={
            contractValue && projections.variationTo
              ? t('variation.consequence', {
                  from: money(contractValue) ?? '',
                  to: money(projections.variationTo) ?? '',
                })
              : null
          }
        />
      ),
    },
    {
      value: 'SEPARATE',
      label: (
        <span className="inline-flex items-center gap-2">
          <Receipt size={15} aria-hidden="true" />
          {t('separate.name')} — {t('separate.tagline')}
        </span>
      ),
      description: (
        <RouteDetail
          detail={t('separate.detail')}
          consequence={
            totalClientRevenue && projections.revenueTo
              ? t('separate.consequence', { amount: money(projections.revenueTo) ?? '' })
              : null
          }
          disabledNote={!separateEnabled ? t('unavailable') : undefined}
        />
      ),
    },
  ];

  const routeEnabled =
    route === 'VARIATION' ||
    (route === 'ABSORB' && absorbEnabled) ||
    (route === 'SEPARATE' && separateEnabled);

  const canSubmit =
    route !== '' && routeEnabled && description.trim().length > 0 && isPositive(amount);

  const cta =
    route === 'ABSORB'
      ? t('absorb.cta')
      : route === 'SEPARATE'
        ? t('separate.cta')
        : t('variation.cta');

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
          <div className="space-y-1.5">
            <Label htmlFor="classifier-desc">{t('descriptionLabel')}</Label>
            <Input
              id="classifier-desc"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t('descriptionPlaceholder')}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="classifier-amount">{t('amountLabel', { currency })}</Label>
            <MoneyInput id="classifier-amount" value={amount} onValueChange={setAmount} />
          </div>

          <RadioGroup
            name="who-pays"
            label={t('subtitle')}
            orientation="vertical"
            value={route}
            onChange={setRoute}
            options={options}
          />

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
          <Button
            disabled={!canSubmit || isPending}
            onClick={() =>
              route !== '' &&
              onSubmit({ route, description: description.trim(), amount: normalize(amount) })
            }
          >
            {cta}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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

/**
 * Projects `base ± amount` in integer cents, display-only. Returns a 2dp string, or null when the
 * base is withheld or the amount is not yet a valid positive figure. Never persisted.
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
