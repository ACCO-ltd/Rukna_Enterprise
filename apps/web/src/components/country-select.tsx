'use client';

import { useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Combobox, type ComboboxOption } from '@erp/ui';

import { countryFlag, phoneCountries } from '@/lib/phone';

/** A searchable country picker (ISO-3166 alpha-2 values), Somalia first. */
export function CountrySelect({
  id,
  value,
  onChange,
  invalid,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (code: string) => void;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations('common.phone');
  const locale = useLocale();
  const options: ComboboxOption[] = useMemo(
    () =>
      phoneCountries(locale).map((country) => ({
        value: country.code,
        label: country.name,
        icon: <span aria-hidden="true">{countryFlag(country.code)}</span>,
      })),
    [locale],
  );

  return (
    <Combobox
      id={id}
      value={value}
      onChange={onChange}
      options={options}
      placeholder={t('searchCountry')}
      searchPlaceholder={t('searchCountry')}
      emptyLabel={t('noCountry')}
      invalid={invalid}
      disabled={disabled}
    />
  );
}
