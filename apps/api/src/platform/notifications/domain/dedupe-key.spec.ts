import { dedupeKey, invoiceBucket } from './dedupe-key.js';

describe('dedupeKey builders', () => {
  it('stageDue', () => {
    expect(dedupeKey.stageDue('inst_1')).toBe('stage-due:inst_1');
  });

  it('stageOverdue', () => {
    expect(dedupeKey.stageOverdue('inst_1')).toBe('stage-overdue:inst_1');
  });

  it('invoiceOverdue embeds the bucket so each age band is its own key', () => {
    expect(dedupeKey.invoiceOverdue('inv_1', 1)).toBe('invoice-overdue:inv_1:1');
    expect(dedupeKey.invoiceOverdue('inv_1', 30)).toBe('invoice-overdue:inv_1:30');
    expect(dedupeKey.invoiceOverdue('inv_1', 60)).toBe('invoice-overdue:inv_1:60');
    expect(dedupeKey.invoiceOverdue('inv_1', 90)).toBe('invoice-overdue:inv_1:90');
  });

  it('the DUE and OVERDUE keys for the same installment are distinct', () => {
    expect(dedupeKey.stageDue('inst_1')).not.toBe(dedupeKey.stageOverdue('inst_1'));
  });
});

describe('invoiceBucket bands', () => {
  it('1..29 days → bucket 1', () => {
    expect(invoiceBucket(1)).toBe(1);
    expect(invoiceBucket(29)).toBe(1);
  });

  it('30..59 days → bucket 30', () => {
    expect(invoiceBucket(30)).toBe(30);
    expect(invoiceBucket(59)).toBe(30);
  });

  it('60..89 days → bucket 60', () => {
    expect(invoiceBucket(60)).toBe(60);
    expect(invoiceBucket(89)).toBe(60);
  });

  it('90+ days → bucket 90', () => {
    expect(invoiceBucket(90)).toBe(90);
    expect(invoiceBucket(400)).toBe(90);
  });
});
