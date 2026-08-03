'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import { Button, FormField, Input } from '@erp/ui';

import { LanguageSwitcher } from '@/components/language-switcher';

import { useLogin } from '../hooks/use-login';

type LoginFormData = { email: string; password: string };

export function LoginForm() {
  const t = useTranslations('auth.login');
  const [showPassword, setShowPassword] = useState(false);
  const { mutate: login, isPending, errorType } = useLogin();
  const loginSchema = z.object({
    email: z.string().email(t('emailInvalid')),
    password: z.string().min(8, t('passwordMinLength')),
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({ resolver: zodResolver(loginSchema) });

  const onSubmit = (data: LoginFormData) => {
    login(data);
  };

  return (
    <main className="w-full max-w-5xl overflow-hidden rounded-lg border border-border bg-surface shadow-[0_18px_50px_rgba(23,32,51,0.10)] lg:grid lg:grid-cols-[0.9fr_1.1fr]">
      <section className="relative flex flex-col justify-between bg-brand-ink px-6 py-6 text-white sm:min-h-72 sm:px-10 sm:py-8 lg:min-h-[620px] lg:px-12 lg:py-12">
        <div>
          <p className="text-sm font-semibold tracking-wide text-white">{t('companyName')}</p>
          <p className="mt-1 text-xs font-medium text-slate-400">{t('productName')}</p>
        </div>

        <div className="my-8 max-w-sm sm:my-12 lg:my-0">
          <p className="mb-4 text-xs font-bold uppercase tracking-[0.18em] text-orange-300">
            {t('eyebrow')}
          </p>
          <h2 className="text-2xl font-semibold leading-tight tracking-tight sm:text-4xl">
            {t('welcomeStatement')}
          </h2>
          <p className="mt-5 hidden max-w-xs text-sm leading-6 text-slate-300 sm:block">
            {t('supportingStatement')}
          </p>
        </div>

        <div className="border-t border-white/15 pt-4 sm:pt-6">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
            {t('tenantLabel')}
          </p>
          <p className="mt-2 text-sm font-semibold">{t('securityTitle')}</p>
          <p className="mt-1 hidden max-w-sm text-xs leading-5 text-slate-400 sm:block">
            {t('securityDescription')}
          </p>
        </div>
      </section>

      <section className="flex flex-col px-6 py-7 sm:px-10 sm:py-10 lg:px-16 lg:py-12">
        <div className="flex justify-end">
          <LanguageSwitcher />
        </div>

        <div className="my-auto py-10 lg:py-6">
          <div className="mb-8">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('subtitle')}</p>
          </div>

          <form className="space-y-5" onSubmit={handleSubmit(onSubmit)} noValidate>
            <FormField htmlFor="email" label={t('emailLabel')} error={errors.email?.message}>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder={t('emailPlaceholder')}
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? 'email-error' : undefined}
                {...register('email')}
              />
            </FormField>

            <FormField
              htmlFor="password"
              label={t('passwordLabel')}
              error={errors.password?.message}
            >
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder={t('passwordPlaceholder')}
                  className="pe-28"
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={errors.password ? 'password-error' : undefined}
                  {...register('password')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute inset-y-0 end-0 min-h-11 px-3 text-xs font-semibold text-brand-primary hover:text-brand-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-primary"
                  aria-label={showPassword ? t('hidePassword') : t('showPassword')}
                >
                  {showPassword ? t('hidePassword') : t('showPassword')}
                </button>
              </div>
            </FormField>

            {errorType === 'credentials' && (
              <div className="rounded-md border border-danger/20 bg-danger-subtle px-4 py-3">
                <p className="text-sm font-medium text-danger" role="alert">
                  {t('invalidCredentials')}
                </p>
              </div>
            )}

            {errorType === 'server' && (
              <div className="rounded-md border border-warning/20 bg-warning-subtle px-4 py-3">
                <p className="text-sm font-medium text-warning" role="alert">
                  {t('serverError')}
                </p>
              </div>
            )}

            <Button type="submit" disabled={isPending} className="mt-2 w-full">
              {isPending ? t('submitting') : t('submitButton')}
            </Button>
          </form>
        </div>

        <p className="border-t border-border pt-5 text-center text-xs leading-5 text-muted-foreground">
          {t('accessNotice')}
        </p>
      </section>
    </main>
  );
}
