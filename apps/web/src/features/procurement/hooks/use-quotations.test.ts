import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

import { applyQuotationDetail, quotationKeys } from './use-quotations';
import { procurementKeys } from './use-procurement';
import type { QuotationRequestDetail } from '../quotations/types';

describe('applyQuotationDetail', () => {
  it('writes the detail and invalidates the lists, the order draft and the MR detail', () => {
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const detail = { id: 'q1', materialRequest: { id: 'mr1' } } as unknown as QuotationRequestDetail;

    applyQuotationDetail(qc, detail);

    expect(qc.getQueryData(quotationKeys.detail('q1'))).toBe(detail);
    const keys = invalidate.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
    expect(keys).toContain(JSON.stringify(quotationKeys.lists()));
    expect(keys).toContain(JSON.stringify(quotationKeys.orderDraft('q1')));
    expect(keys).toContain(JSON.stringify(procurementKeys.materialRequest('mr1')));
  });
});
