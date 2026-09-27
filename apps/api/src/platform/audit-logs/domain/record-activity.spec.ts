import { activityCode } from './record-activity.js';

describe('activityCode', () => {
  it('names the command after the record id', () => {
    expect(activityCode('POST', '/bills/:id/approve')).toBe('bills.approve');
    expect(activityCode('POST', '/bills/:id/post')).toBe('bills.post');
    expect(activityCode('POST', '/procurement/bill-matching/:billId/run')).toBe('bill-matching.run');
    expect(activityCode('POST', '/api/v1/procurement/bill-matching/:billId/approve-exception')).toBe(
      'bill-matching.approve-exception',
    );
  });

  it('falls back to the HTTP verb when the route has no command segment', () => {
    expect(activityCode('PATCH', '/bills/:id')).toBe('bills.update');
    expect(activityCode('POST', '/bills')).toBe('bills.create');
    expect(activityCode('DELETE', '/bills/:id')).toBe('bills.delete');
  });

  it('skips the global API prefix the stored route carries', () => {
    expect(activityCode('POST', '/api/v1/bills/:id/approve')).toBe('bills.approve');
    expect(activityCode('PATCH', '/api/v1/bills/:id')).toBe('bills.update');
  });

  it('ignores doubled slashes and parameter-only routes', () => {
    expect(activityCode('POST', '//bills//:id//submit')).toBe('bills.submit');
    expect(activityCode('POST', '/:id')).toBe('record.create');
  });
});
