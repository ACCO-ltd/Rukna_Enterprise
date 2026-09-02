'use client';

import { useId, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  FormField,
  Input,
  Select,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  Textarea,
} from '@erp/ui';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { PROCUREMENT_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';

import {
  useCreateMaterial,
  useDiscontinueMaterial,
  useMaterialCategories,
  useMaterials,
  useSpendCategories,
  useUoms,
} from '../hooks/use-procurement';
import type { Material, MaterialCategory, SpendCategory } from '../types';
import { ProcurementStatusBadge } from './procurement-badges';
import { CreateForm, SetupScreen } from './setup-shell';

/** Flattens a two-level category tree into option rows, children indented. */
function flatten<T extends { id: string; code: string; name: string; children?: T[] }>(
  roots: T[] | undefined,
): { id: string; code: string; label: string }[] {
  return (roots ?? []).flatMap((root) => [
    { id: root.id, code: root.code, label: `${root.code} · ${root.name}` },
    ...(root.children ?? []).map((child) => ({
      id: child.id,
      code: child.code,
      label: `  ↳ ${child.code} · ${child.name}`,
    })),
  ]);
}

/**
 * The material catalogue (§12.4).
 *
 * Category filters are server-side — `materialCategoryId` and `spendCategoryId` are the
 * two parameters the controller reads. Status is not among them and the service hard-codes
 * `ACTIVE` (P2), so there is no status filter and discontinuing a material removes it from
 * the only view there is.
 */
export function MaterialsList() {
  const t = useTranslations('procurement.material');
  const tc = useTranslations('procurement.common');
  const { can } = usePermissions();

  const [materialCategoryId, setMaterialCategoryId] = useState('');
  const [spendCategoryId, setSpendCategoryId] = useState('');
  const [pending, setPending] = useState<Material | null>(null);

  const materials = useMaterials({
    ...(materialCategoryId ? { materialCategoryId } : {}),
    ...(spendCategoryId ? { spendCategoryId } : {}),
  });
  const categories = useMaterialCategories();
  const spendCategories = useSpendCategories();
  const discontinue = useDiscontinueMaterial();

  const canManage = can(PROCUREMENT_PERMISSIONS.manageConfig);
  const filterIds = { category: useId(), spend: useId() };

  return (
    <>
      <SetupScreen
        title={t('title')}
        subtitle={t('subtitle')}
        notice={t('activeOnlyNotice')}
        createLabel={t('new')}
        createTitle={t('createTitle')}
        canCreate={canManage}
        createForm={(close) => <MaterialCreateForm onDone={close} />}
        isPending={materials.isPending}
        isError={materials.isError}
      >
        <div className="flex flex-wrap gap-4">
          <div className="min-w-48 flex-1">
            <label
              htmlFor={filterIds.category}
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              {t('filterByCategory')}
            </label>
            <Select
              id={filterIds.category}
              value={materialCategoryId}
              onChange={(value) => setMaterialCategoryId(value)}
            >
              <option value="">{tc('all')}</option>
              {flatten<MaterialCategory>(categories.data).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="min-w-48 flex-1">
            <label
              htmlFor={filterIds.spend}
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              {t('filterBySpendCategory')}
            </label>
            <Select
              id={filterIds.spend}
              value={spendCategoryId}
              onChange={(value) => setSpendCategoryId(value)}
            >
              <option value="">{tc('all')}</option>
              {flatten<SpendCategory>(spendCategories.data).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <TableScroll aria-label={t('title')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tc('code')}</TableHead>
                <TableHead>{tc('name')}</TableHead>
                <TableHead>{t('baseUom')}</TableHead>
                <TableHead>{t('materialCategory')}</TableHead>
                <TableHead>{t('defaultSpendCategory')}</TableHead>
                <TableHead>{tc('status')}</TableHead>
                <TableHead>
                  <span className="sr-only">{tc('actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(materials.data ?? []).length === 0 ? (
                <TableEmpty colSpan={7}>{t('empty')}</TableEmpty>
              ) : (
                (materials.data ?? []).map((material) => (
                  <TableRow key={material.id}>
                    <TableCell className="font-mono text-xs">{material.code}</TableCell>
                    <TableCell>
                      <span className="text-sm text-foreground">{material.name}</span>
                    </TableCell>
                    <TableCell>
                      <bdi className="text-sm">
                        {material.baseUom?.symbol ?? material.baseUom?.code ?? tc('notAvailable')}
                      </bdi>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {material.materialCategory?.name ?? tc('notAvailable')}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {material.defaultSpendCategory?.name ?? tc('notAvailable')}
                    </TableCell>
                    <TableCell>
                      <ProcurementStatusBadge status={material.status} />
                    </TableCell>
                    <TableCell>
                      {canManage && material.status === 'ACTIVE' ? (
                        <button
                          type="button"
                          onClick={() => setPending(material)}
                          className="min-h-11 text-sm font-medium text-danger underline-offset-2 hover:underline"
                        >
                          {t('discontinue')}
                        </button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableScroll>
      </SetupScreen>

      {pending ? (
        <ConfirmActionDialog
          title={t('discontinueTitle', { code: pending.code })}
          description={`${t('discontinueBody')} ${t('discontinueWarning', {
            code: pending.code,
          })}`}
          confirmLabel={t('discontinue')}
          isPending={discontinue.isPending}
          errorMessage={discontinue.isError ? tc('loadFailed') : undefined}
          onConfirm={() =>
            discontinue.mutate(pending.id, { onSuccess: () => setPending(null) })
          }
          onDismiss={() => setPending(null)}
        />
      ) : null}
    </>
  );
}

function MaterialCreateForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations('procurement.material');
  const tc = useTranslations('procurement.common');
  const ids = {
    code: useId(),
    name: useId(),
    description: useId(),
    category: useId(),
    spend: useId(),
    uom: useId(),
  };

  const create = useCreateMaterial();
  const categories = useMaterialCategories();
  const spendCategories = useSpendCategories();
  const uoms = useUoms();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    const code = String(form.get('code') ?? '').trim();
    const name = String(form.get('name') ?? '').trim();
    const materialCategoryCode = String(form.get('materialCategoryCode') ?? '').trim();
    const baseUomCode = String(form.get('baseUomCode') ?? '').trim();
    const description = String(form.get('description') ?? '').trim();
    const defaultSpendCategoryCode = String(form.get('defaultSpendCategoryCode') ?? '').trim();

    if (!code || !name || !materialCategoryCode || !baseUomCode) return;

    create.mutate(
      {
        code,
        name,
        materialCategoryCode,
        baseUomCode,
        ...(description ? { description } : {}),
        ...(defaultSpendCategoryCode ? { defaultSpendCategoryCode } : {}),
      },
      { onSuccess: onDone },
    );
  }

  return (
    <CreateForm
      onSubmit={handleSubmit}
      isPending={create.isPending}
      error={create.error}
      onCancel={onDone}
    >
      <FormField htmlFor={ids.code} label={tc('code')}>
        <Input id={ids.code} name="code" required maxLength={50} autoComplete="off" />
      </FormField>

      <FormField htmlFor={ids.name} label={tc('name')}>
        <Input id={ids.name} name="name" required autoComplete="off" />
      </FormField>

      <FormField htmlFor={ids.description} label={`${tc('description')} (${tc('optional')})`}>
        <Textarea id={ids.description} name="description" rows={2} />
      </FormField>

      <FormField htmlFor={ids.category} label={t('materialCategory')}>
        <Select
          id={ids.category}
          name="materialCategoryCode"
          required
          defaultValue=""
        >
          <option value="" disabled>
            —
          </option>
          {flatten<MaterialCategory>(categories.data).map((c) => (
            <option key={c.id} value={c.code}>
              {c.label}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField
        htmlFor={ids.spend}
        label={`${t('defaultSpendCategory')} (${tc('optional')})`}
      >
        <Select
          id={ids.spend}
          name="defaultSpendCategoryCode"
          defaultValue=""
        >
          <option value="">—</option>
          {flatten<SpendCategory>(spendCategories.data).map((c) => (
            <option key={c.id} value={c.code}>
              {c.label}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField htmlFor={ids.uom} label={t('baseUom')}>
        <Select
          id={ids.uom}
          name="baseUomCode"
          required
          defaultValue=""
        >
          <option value="" disabled>
            —
          </option>
          {(uoms.data ?? []).map((u) => (
            <option key={u.id} value={u.code}>
              {u.code} · {u.name}
            </option>
          ))}
        </Select>
        {/* §12.4 asks for this to be said out loud on the field. It is the only decision on
            this form that cannot be undone — there is no edit endpoint, and every future
            order and receipt for the material inherits it. */}
        <Alert variant="warning" messages={[t('baseUomWarning')]} />
      </FormField>
    </CreateForm>
  );
}
