'use client';

/**
 * Material categories and spend categories — two trees on the same component. Spend categories
 * are the financial hierarchy (approval routing, tolerance, commitment attribution) and are not
 * material categories; the page title says which is which.
 */

import { useState } from 'react';
import type { FilterValues } from '@erp/ui';

import {
  useCreateMaterialCategory,
  useCreateSpendCategory,
  useDeactivateMaterialCategory,
  useDeactivateSpendCategory,
  useMaterialCategories,
  useReactivateMaterialCategory,
  useReactivateSpendCategory,
  useSpendCategories,
} from '../hooks/use-procurement';
import { statusFrom } from './catalogue-list';
import { CategoryTree } from './category-tree';

export function MaterialCategoriesScreen() {
  const [filters, setFilters] = useState<FilterValues>({});
  const list = useMaterialCategories(statusFrom(filters));
  const parents = useMaterialCategories();
  const create = useCreateMaterialCategory();
  const deactivate = useDeactivateMaterialCategory();
  const reactivate = useReactivateMaterialCategory();

  return (
    <CategoryTree
      namespace="materialCategory"
      data={list.data}
      isPending={list.isPending}
      isError={list.isError}
      onRetry={() => void list.refetch()}
      filterValues={filters}
      onFilterValuesChange={setFilters}
      parentOptions={parents.data ?? []}
      onCreate={(payload, options) => create.mutate(payload, options)}
      isCreating={create.isPending}
      createError={create.error}
      deactivate={deactivate}
      reactivate={reactivate}
    />
  );
}

export function SpendCategoriesScreen() {
  const [filters, setFilters] = useState<FilterValues>({});
  const list = useSpendCategories(statusFrom(filters));
  const parents = useSpendCategories();
  const create = useCreateSpendCategory();
  const deactivate = useDeactivateSpendCategory();
  const reactivate = useReactivateSpendCategory();

  return (
    <CategoryTree
      namespace="spendCategory"
      data={list.data}
      isPending={list.isPending}
      isError={list.isError}
      onRetry={() => void list.refetch()}
      filterValues={filters}
      onFilterValuesChange={setFilters}
      parentOptions={parents.data ?? []}
      onCreate={(payload, options) => create.mutate(payload, options)}
      isCreating={create.isPending}
      createError={create.error}
      deactivate={deactivate}
      reactivate={reactivate}
    />
  );
}
