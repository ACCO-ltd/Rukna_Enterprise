'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Badge,
  Button,
  FormField,
  Input,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';

import { usePermissions } from '@/features/auth/permissions/can';
import { ApiError } from '@/lib/api-client';
import { useDistricts, useCreateDistrict, useUpdateDistrict } from '../hooks/use-districts';

export function DistrictsManager() {
  const t = useTranslations('platform.districts');
  const tCommon = useTranslations('common');
  const { can } = usePermissions();
  const canManage = can('manage:district');

  const { data: districts, isPending, isError, refetch } = useDistricts(false);
  const create = useCreateDistrict();
  const update = useUpdateDistrict();

  const [code, setCode] = useState('');
  const [name, setName] = useState('');

  const createError =
    create.error instanceof ApiError && create.error.messages.length > 0
      ? create.error.message
      : create.isError
        ? t('createFailed')
        : null;

  function onCreate() {
    if (!code.trim() || !name.trim()) return;
    create.mutate(
      { code: code.trim().toUpperCase(), name: name.trim() },
      {
        onSuccess: () => {
          setCode('');
          setName('');
        },
      },
    );
  }

  if (isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
        <div className="h-64 animate-pulse rounded-panel border border-border bg-muted" aria-hidden="true" />
      </div>
    );
  }

  if (isError) {
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

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{t('intro')}</p>

      {canManage ? (
        <div className="rounded-panel border border-border bg-surface p-4">
          <h2 className="text-base font-semibold leading-6 text-foreground">{t('addTitle')}</h2>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <FormField htmlFor="district-code" label={t('codeLabel')} className="w-28">
              <Input
                id="district-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={8}
                className="uppercase"
                placeholder="WBR"
              />
            </FormField>
            <FormField htmlFor="district-name" label={t('nameLabel')} className="min-w-52 flex-1">
              <Input
                id="district-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                placeholder="Waaberi"
              />
            </FormField>
            <Button type="button" onClick={onCreate} disabled={create.isPending || !code.trim() || !name.trim()}>
              {create.isPending ? tCommon('loading') : t('add')}
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t('codeHint')}</p>
          {createError ? <Alert variant="error" messages={[createError]} className="mt-3" /> : null}
        </div>
      ) : null}

      <TableScroll>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('codeLabel')}</TableHead>
              <TableHead>{t('nameLabel')}</TableHead>
              <TableHead>{t('statusLabel')}</TableHead>
              {canManage ? <TableHead className="text-end">{t('actionsLabel')}</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {districts.length === 0 ? (
              <TableEmpty colSpan={canManage ? 4 : 3}>{t('empty')}</TableEmpty>
            ) : (
              districts.map((district) => (
                <TableRow key={district.id}>
                  <TableCell className="font-mono text-xs">{district.code}</TableCell>
                  <TableCell className="text-sm text-foreground">{district.name}</TableCell>
                  <TableCell>
                    <Badge tone={district.active ? 'live' : 'neutral'}>
                      {district.active ? t('active') : t('inactive')}
                    </Badge>
                  </TableCell>
                  {canManage ? (
                    <TableCell className="text-end">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={update.isPending}
                        onClick={() =>
                          update.mutate({ id: district.id, payload: { active: !district.active } })
                        }
                      >
                        {district.active ? t('deactivate') : t('activate')}
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableScroll>
    </div>
  );
}
