import { PERMISSIONS } from '@erp/types';

import { canChangeAttachments, canReadAttachments, isInTheBooks } from './finance-attachment-policy.js';

describe('finance attachment policy', () => {
  it('changes evidence only with the permission that runs the document', () => {
    expect(canChangeAttachments([PERMISSIONS.receivablesManage], 'INVOICE')).toBe(true);
    expect(canChangeAttachments([PERMISSIONS.receivablesManage], 'BILL')).toBe(false);
    expect(canChangeAttachments([PERMISSIONS.payablesManage], 'PAYMENT')).toBe(true);
    expect(canChangeAttachments([PERMISSIONS.journalsManage], 'JOURNAL')).toBe(true);
    expect(canChangeAttachments([PERMISSIONS.accountingView], 'JOURNAL')).toBe(false);
  });

  it('lets a reader of the books open any document’s evidence', () => {
    expect(canReadAttachments([PERMISSIONS.accountingView], 'BILL')).toBe(true);
    expect(canReadAttachments([PERMISSIONS.receivablesManage], 'PAYMENT')).toBe(false);
  });

  it('treats a reversed document as still in the books', () => {
    expect(isInTheBooks('POSTED')).toBe(true);
    expect(isInTheBooks('REVERSED')).toBe(true);
    expect(isInTheBooks('NOT_POSTED')).toBe(false);
    expect(isInTheBooks('APPROVED')).toBe(false);
  });
});
