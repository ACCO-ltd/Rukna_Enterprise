'use client';

import { useTranslations } from 'next-intl';
import { FormField, Input } from '@erp/ui';

import { isEmailFormat, isPersonalEmail, suggestEmailCorrection } from '@/lib/email-hints';

export interface EmailFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  error?: string;
  hint?: string;
  placeholder?: string;
  required?: boolean;
  /** Warn (never block) when the address is at a free webmail domain — for an organisation. */
  warnPersonal?: boolean;
  className?: string;
}

/**
 * An email field with the two non-blocking hints the client screens use: a "did you mean
 * gmail.com?" correction for a misspelt common domain (one click applies it), and a
 * personal-address warning when the record is an organisation. Format errors come from the
 * form's own validation through `error`.
 */
export function EmailField({
  id,
  label,
  value,
  onChange,
  onBlur,
  error,
  hint,
  placeholder,
  required,
  warnPersonal,
  className,
}: EmailFieldProps) {
  const t = useTranslations('common.email');
  const suggestion = value.trim() ? suggestEmailCorrection(value) : null;
  const personal = Boolean(warnPersonal) && isEmailFormat(value) && isPersonalEmail(value);

  return (
    <FormField
      htmlFor={id}
      label={label}
      hint={hint}
      error={error}
      warning={personal ? t('personal') : undefined}
      required={required}
      className={className}
    >
      <Input
        id={id}
        type="email"
        dir="ltr"
        autoComplete="email"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
      {suggestion ? (
        <p className="mt-1.5 text-caption text-muted-foreground">
          {t('didYouMean', { email: suggestion })}{' '}
          <button
            type="button"
            onClick={() => onChange(suggestion)}
            className="font-medium text-brand-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"
          >
            {t('useSuggestion', { email: suggestion })}
          </button>
        </p>
      ) : null}
    </FormField>
  );
}
