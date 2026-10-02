'use client';

import { useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Combobox, Input, type ComboboxOption } from '@erp/ui';

import { countryFlag, phoneCountries, type PhoneValue } from '@/lib/phone';

export interface PhoneInputProps {
  /** Id of the number box — pass the FormField's `htmlFor`, so the label names the number. */
  id: string;
  value: PhoneValue;
  onChange: (next: PhoneValue) => void;
  onBlur?: () => void;
  invalid?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

/**
 * A phone number as two halves: a searchable country-code picker (flag, country, dial code —
 * Somalia +252 first and by default) and the national number. The caller converts the pair to
 * E.164 with `toE164` from `@/lib/phone`, which is what the API stores.
 *
 * Typing a full international number (`+254 712 …`) into the number box also works: the `+`
 * prefix wins over the picked country, the same as the server's parser.
 */
export function PhoneInput({
  id,
  value,
  onChange,
  onBlur,
  invalid,
  disabled,
  placeholder,
}: PhoneInputProps) {
  const t = useTranslations('common.phone');
  const locale = useLocale();
  const options: ComboboxOption[] = useMemo(
    () =>
      phoneCountries(locale).map((country) => ({
        value: country.code,
        label: country.name,
        hint: country.dialCode,
        icon: <span aria-hidden="true">{countryFlag(country.code)}</span>,
      })),
    [locale],
  );

  return (
    <div className="flex min-w-0 gap-2">
      <Combobox
        id={`${id}-country`}
        aria-label={t('countryCode')}
        value={value.country}
        onChange={(country) => onChange({ ...value, country })}
        options={options}
        placeholder={t('countryCode')}
        searchPlaceholder={t('searchCountry')}
        emptyLabel={t('noCountry')}
        disabled={disabled}
        invalid={invalid}
        className="w-28 shrink-0"
        panelClassName="min-w-72"
        renderValue={(option) => (
          <span className="inline-flex items-center gap-1.5 tabular-nums" dir="ltr">
            <span aria-hidden="true">{countryFlag(option.value)}</span>
            {option.hint}
          </span>
        )}
      />
      <Input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        dir="ltr"
        className="min-w-0 flex-1"
        placeholder={placeholder ?? t('numberPlaceholder')}
        value={value.number}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange({ ...value, number: event.target.value })}
        onBlur={onBlur}
      />
    </div>
  );
}
