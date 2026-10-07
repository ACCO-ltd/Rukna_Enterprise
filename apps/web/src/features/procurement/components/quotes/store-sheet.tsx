'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Button,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
  Input,
  Label,
  cn,
} from '@erp/ui';
import { Camera, Check, Plus, Store } from 'lucide-react';

import { useSupplierDirectory } from '../../hooks/use-procurement';
import type { StoreChoice } from '../../quotations/capture/upload-queue';
import { storeKey } from '../../quotations/quote-rules';

const SUPPLIER_CHIP_LIMIT = 8;

/**
 * "Which store?" — opened right after a snap, while the photo is already uploading. One tap on a
 * chip names the store and closes the sheet: recent stores first, registered suppliers matching
 * what is typed, and "New store: …" for a name not on file. No prices anywhere: finance reads
 * them from the photo.
 */
export function StoreSheet({
  open,
  pagesTaken,
  recent,
  usedKeys,
  onChoose,
  onAddPage,
  onClose,
}: {
  open: boolean;
  pagesTaken: number;
  recent: StoreChoice[];
  /** Stores already on this request — a second quote from one store does not count. */
  usedKeys: ReadonlySet<string>;
  onChoose: (choice: StoreChoice) => void;
  onAddPage: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('procurement.quotes.capture.store');
  const tCapture = useTranslations('procurement.quotes.capture');
  const tCommon = useTranslations('common');
  const [query, setQuery] = useState('');
  const suppliers = useSupplierDirectory({ status: 'ACTIVE' }, { enabled: open });

  const needle = query.trim().toLowerCase().replace(/\s+/g, ' ');
  const recentShown = useMemo(
    () => recent.filter((choice) => !needle || choice.label.toLowerCase().includes(needle)),
    [recent, needle],
  );
  const recentKeys = useMemo(() => new Set(recent.map((choice) => storeKey(choice))), [recent]);
  const supplierChoices = useMemo<StoreChoice[]>(
    () =>
      (suppliers.data ?? [])
        .filter((s) => !recentKeys.has(`supplier:${s.id}`))
        .filter((s) => !needle || s.name.toLowerCase().includes(needle) || s.code.toLowerCase().includes(needle))
        .slice(0, SUPPLIER_CHIP_LIMIT)
        .map((s) => ({ supplierId: s.id, label: s.name })),
    [suppliers.data, recentKeys, needle],
  );
  const exactMatch =
    needle !== '' &&
    [...recentShown, ...supplierChoices].some((choice) => choice.label.trim().toLowerCase().replace(/\s+/g, ' ') === needle);
  const typedName = query.trim().replace(/\s+/g, ' ');

  const choose = (choice: StoreChoice) => {
    setQuery('');
    onChoose(choice);
  };

  const chip = (choice: StoreChoice) => {
    const used = usedKeys.has(storeKey(choice));
    return (
      <Button
        key={storeKey(choice)}
        type="button"
        variant="outline"
        className={cn('min-h-11 max-w-full rounded-full px-4', used && 'opacity-60')}
        aria-disabled={used || undefined}
        onClick={() => {
          if (!used) choose(choice);
        }}
      >
        <span className="truncate">{choice.label}</span>
        {used ? (
          <span className="flex items-center gap-1 text-caption font-normal text-muted-foreground">
            <Check className="size-3.5" aria-hidden="true" />
            {t('alreadyAdded')}
          </span>
        ) : null}
      </Button>
    );
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t('title')}
      subtitle={t('subtitle')}
      icon={<Store className="size-4" aria-hidden="true" />}
      closeLabel={tCommon('close')}
      // Not the search field: on a phone that would raise the keyboard over the store chips.
      initialFocus="dialog"
      onSubmit={(event) => {
        event.preventDefault();
        if (typedName && !exactMatch) choose({ storeName: typedName, label: typedName });
      }}
    >
      <FormDialogBody className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-body-sm text-muted-foreground" aria-live="polite">
            {t('pagesTaken', { count: pagesTaken })}
          </p>
          <Button type="button" variant="outline" className="min-h-11" onClick={onAddPage}>
            <Camera className="size-4" aria-hidden="true" />
            {tCapture('addPage')}
          </Button>
        </div>

        <div>
          <Label htmlFor="quote-store-search">{t('searchLabel')}</Label>
          <Input
            id="quote-store-search"
            // The server keeps a new store name to 120 characters (STORE_NAME_TOO_LONG).
            maxLength={120}
            className="mt-1.5"
            value={query}
            autoComplete="off"
            enterKeyHint="done"
            placeholder={t('searchPlaceholder')}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        {typedName && !exactMatch ? (
          <Button
            type="button"
            className="min-h-11 w-full justify-start rounded-full"
            onClick={() => choose({ storeName: typedName, label: typedName })}
          >
            <Plus className="size-4" aria-hidden="true" />
            <span className="truncate">{t('newStore', { name: typedName })}</span>
          </Button>
        ) : null}

        {recentShown.length > 0 ? (
          <section aria-labelledby="quote-store-recent">
            <h3 id="quote-store-recent" className="mb-2 text-caption font-semibold text-muted-foreground">
              {t('recent')}
            </h3>
            <div className="flex flex-wrap gap-2">{recentShown.map(chip)}</div>
          </section>
        ) : null}

        {suppliers.isPending ? (
          <p className="text-caption text-muted-foreground">{t('loadingSuppliers')}</p>
        ) : supplierChoices.length > 0 ? (
          <section aria-labelledby="quote-store-suppliers">
            <h3 id="quote-store-suppliers" className="mb-2 text-caption font-semibold text-muted-foreground">
              {t('suppliers')}
            </h3>
            <div className="flex flex-wrap gap-2">{supplierChoices.map(chip)}</div>
          </section>
        ) : null}
      </FormDialogBody>
      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="ghost" className="min-h-11">
            {t('later')}
          </Button>
        </FormDialogClose>
      </FormDialogFooter>
    </FormDialog>
  );
}
