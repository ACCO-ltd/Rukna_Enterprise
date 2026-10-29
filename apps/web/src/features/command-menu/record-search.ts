'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SearchRecord, SearchRecordKind, SearchResponse } from '@erp/types';

import { apiClient } from '@/lib/api-client';

/** Where each record opens. Suppliers have no detail page yet, so they open the filtered list. */
export function recordHref(record: SearchRecord): string {
  const hrefs: Record<SearchRecordKind, string> = {
    INVOICE: `/finance/accounting/invoices/${record.id}`,
    BILL: `/finance/accounting/bills/${record.id}`,
    PAYMENT: `/finance/accounting/payments/${record.id}`,
    RECEIPT: `/receipts/${record.id}`,
    JOURNAL: `/finance/accounting/journals/${record.id}`,
    PROJECT: `/projects/${record.id}`,
    CLIENT: `/clients/${record.id}`,
    SUPPLIER: `/procurement/suppliers`,
  };
  return hrefs[record.kind];
}

/**
 * `GET /search?q=` (Step 2f), debounced so typing "hargeisa" is one request, not eight. Under two
 * characters nothing is asked — the server would answer empty anyway.
 */
export function useRecordSearch(query: string) {
  const [debounced, setDebounced] = useState(query.trim());
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query]);
  return useQuery({
    queryKey: ['search', debounced],
    queryFn: () => apiClient<SearchResponse>(`/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 2,
    staleTime: 15_000,
    placeholderData: (previous) => previous,
  });
}
