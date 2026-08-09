'use client';

/**
 * The two category screens, each binding `CategoryTree` to its own endpoints.
 *
 * Thin on purpose. The only thing that differs between them is which four hooks they
 * use and which translation namespace they read — and that difference is the whole point,
 * because material categories and spend categories must never be presented as the same
 * concept (§12.4).
 */

import {
  useCreateMaterialCategory,
  useCreateSpendCategory,
  useDeactivateMaterialCategory,
  useDeactivateSpendCategory,
  useMaterialCategories,
  useSpendCategories,
} from '../hooks/use-procurement';
import { CategoryTree } from './category-tree';

export function MaterialCategoriesScreen() {
  const list = useMaterialCategories();
  const create = useCreateMaterialCategory();
  const deactivate = useDeactivateMaterialCategory();

  return (
    <CategoryTree
      namespace="materialCategory"
      data={list.data}
      isPending={list.isPending}
      isError={list.isError}
      onCreate={(payload, options) => create.mutate(payload, options)}
      isCreating={create.isPending}
      createError={create.error}
      onDeactivate={(id, options) => deactivate.mutate(id, options)}
      isDeactivating={deactivate.isPending}
      deactivateError={deactivate.isError}
    />
  );
}

export function SpendCategoriesScreen() {
  const list = useSpendCategories();
  const create = useCreateSpendCategory();
  const deactivate = useDeactivateSpendCategory();

  return (
    <CategoryTree
      namespace="spendCategory"
      data={list.data}
      isPending={list.isPending}
      isError={list.isError}
      onCreate={(payload, options) => create.mutate(payload, options)}
      isCreating={create.isPending}
      createError={create.error}
      onDeactivate={(id, options) => deactivate.mutate(id, options)}
      isDeactivating={deactivate.isPending}
      deactivateError={deactivate.isError}
    />
  );
}
