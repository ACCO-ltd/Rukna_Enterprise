import { describe, expect, it } from 'vitest';

import type { ReceivablePoLine } from '../types';
import {
  acceptedValueMinor,
  grnLineErrors,
  grnLineOutcome,
  grnLinesFromReceivable,
  stillDueMinor,
  submittableGrnLines,
  toGrnLinePayload,
  type GrnLineDraft,
} from './grn-line-editor';

const poLine = (id: string, orderedQuantity: string, acceptedQuantity: string): ReceivablePoLine => ({
  purchaseOrderLineId: id,
  lineNumber: 1,
  description: 'Cement 50kg',
  uomCode: 'BAG',
  uomSymbol: 'bag',
  orderedQuantity,
  acceptedQuantity,
  remainingQuantity: '0',
});

const [cement] = grnLinesFromReceivable([poLine('l1', '100', '40')], { l1: '10.00' });
const line = (patch: Partial<GrnLineDraft> = {}): GrnLineDraft => ({ ...cement!, ...patch });

describe('grnLinesFromReceivable', () => {
  it('prefills each line with what is still due', () => {
    expect(cement).toMatchObject({
      description: 'Cement 50kg',
      uomSymbol: 'bag',
      receivedBefore: '40',
      delivered: '60',
      problemOpen: false,
    });
    expect(stillDueMinor(cement!)).toBe(60_000);
  });

  it('starts a line received in full at nothing, so it is not received again', () => {
    const [done] = grnLinesFromReceivable([poLine('l2', '10', '10')]);
    expect(done!.delivered).toBe('');
    expect(submittableGrnLines([done!])).toHaveLength(0);
  });
});

describe('grnLineOutcome', () => {
  it('accepts the whole delivery when no problem is reported', () => {
    expect(grnLineOutcome(line({ delivered: '60' }))).toEqual({
      receivedMinor: 60_000,
      acceptedMinor: 60_000,
      rejectedMinor: 0,
      qualityStatus: 'ACCEPTED',
    });
  });

  it('derives accepted = delivered − rejected and a partial status', () => {
    expect(grnLineOutcome(line({ delivered: '60', problemOpen: true, rejected: '5', reason: 'Torn' }))).toMatchObject({
      acceptedMinor: 55_000,
      rejectedMinor: 5_000,
      qualityStatus: 'PARTIALLY_ACCEPTED',
    });
  });

  it('marks a wholly rejected line REJECTED', () => {
    expect(grnLineOutcome(line({ delivered: '60', problemOpen: true, rejected: '60', reason: 'Wet' })).qualityStatus).toBe(
      'REJECTED',
    );
  });
});

describe('grnLineErrors', () => {
  it('refuses more rejected than delivered', () => {
    expect(grnLineErrors(line({ delivered: '5', problemOpen: true, rejected: '6', reason: 'x' }))).toEqual({
      rejected: 'rejectedOverDelivered',
    });
  });

  it('asks for a reason when something is rejected', () => {
    expect(grnLineErrors(line({ delivered: '5', problemOpen: true, rejected: '1', reason: '  ' }))).toEqual({
      reason: 'reasonRequired',
    });
  });

  it('treats over-receipt as no error at all — the server records or holds it', () => {
    expect(grnLineErrors(line({ delivered: '80' }))).toEqual({});
  });
});

describe('payload and value', () => {
  it('sends received, accepted, rejected, reason and the derived quality', () => {
    expect(toGrnLinePayload(line({ delivered: '60', problemOpen: true, rejected: '5', reason: ' Torn bags ' }))).toEqual({
      purchaseOrderLineId: 'l1',
      receivedQuantity: 60,
      acceptedQuantity: 55,
      rejectedQuantity: 5,
      rejectionReason: 'Torn bags',
      qualityStatus: 'PARTIALLY_ACCEPTED',
    });
    expect(toGrnLinePayload(line({ delivered: '60' }))).toEqual({
      purchaseOrderLineId: 'l1',
      receivedQuantity: 60,
      acceptedQuantity: 60,
      qualityStatus: 'ACCEPTED',
    });
  });

  it('values only what is accepted, at the order price', () => {
    expect(acceptedValueMinor([line({ delivered: '60', problemOpen: true, rejected: '5', reason: 'x' })])).toBe(55_000);
  });
});
