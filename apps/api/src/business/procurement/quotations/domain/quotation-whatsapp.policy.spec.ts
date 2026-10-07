import { WHATSAPP_TEMPLATE_BODIES, renderWhatsAppMessage } from '../../../../platform/messaging/whatsapp/whatsapp-send-preview.js';
import { isWithinWorkingHours } from './quotation-sla.policy.js';
import {
  NOTE_MAX_LENGTH,
  alertBodyParams,
  alertIdempotencyKey,
  alertStillWanted,
  decisionRound,
  paymentPathTextSo,
  roundOfKey,
  sanitiseTemplateParam,
  slaAlertsDue,
  waitingTextSo,
} from './quotation-whatsapp.policy.js';

const at = (iso: string) => new Date(iso);
// Mogadishu = UTC+3. 2026-10-08 is a Thursday, 10-09 Friday, 10-10 Saturday.

describe('quotation WhatsApp policy (ADR-044 phase 2)', () => {
  describe('sanitiseTemplateParam', () => {
    it('removes newlines, tabs and long space runs (Meta refuses them) and never returns empty', () => {
      expect(sanitiseTemplateParam('Need\n\ttwo   more\r\n    stores')).toBe('Need two more stores');
      expect(sanitiseTemplateParam('   ')).toBe('-');
      expect(sanitiseTemplateParam(null)).toBe('-');
      expect(sanitiseTemplateParam(3)).toBe('3');
      expect(sanitiseTemplateParam('a\u0000b')).toBe('a b');
    });

    it('truncates to the limit with an ellipsis, counting characters not UTF-16 units', () => {
      const long = 'x'.repeat(300);
      const out = sanitiseTemplateParam(long, NOTE_MAX_LENGTH);
      expect([...out]).toHaveLength(NOTE_MAX_LENGTH);
      expect(out.endsWith('…')).toBe(true);
      expect(sanitiseTemplateParam('Dukaanka Xamar', 60)).toBe('Dukaanka Xamar');
      expect([...sanitiseTemplateParam('😀'.repeat(70), 60)]).toHaveLength(60);
    });
  });

  it('Somali waiting text and payment path', () => {
    expect(waitingTextSo(45)).toBe('45 daqiiqo');
    expect(waitingTextSo(60)).toBe('1 saac');
    expect(waitingTextSo(125)).toBe('2 saacadood');
    expect(waitingTextSo(240)).toBe('4 saacadood');
    expect(paymentPathTextSo('BUYER_CASH')).toBe('Iibsaduhu kaash ayuu bixinayaa');
    expect(paymentPathTextSo('FINANCE_PAYS_SUPPLIER')).toBe('Maaliyadda ayaa bixinaysa');
  });

  describe('alertBodyParams', () => {
    const facts = { number: 'QR-00007', mrNumber: 'MR-00042', projectName: 'Hodan Tower', quoteCount: 3 };

    it('fills each template in order; no amounts anywhere', () => {
      expect(alertBodyParams('QUOTE_READY', facts)).toEqual(['QR-00007', 'MR-00042', 'Hodan Tower', '3']);
      expect(alertBodyParams('QUOTE_REMINDER', { ...facts, waitingMinutes: 121 })).toEqual(['QR-00007', 'MR-00042', '2 saacadood']);
      expect(alertBodyParams('QUOTE_ESCALATION', { ...facts, waitingMinutes: 250 })).toEqual([
        'QR-00007',
        'MR-00042',
        'Hodan Tower',
        '4 saacadood',
      ]);
      expect(alertBodyParams('QUOTE_CHOSEN', { ...facts, storeName: 'Bakaaraha Store', paymentPath: 'BUYER_CASH' })).toEqual([
        'Bakaaraha Store',
        'MR-00042',
        'Iibsaduhu kaash ayuu bixinayaa',
      ]);
      expect(alertBodyParams('QUOTE_ANOTHER', { ...facts, note: 'One more\nstore please' })).toEqual([
        'MR-00042',
        'One more store please',
      ]);
    });

    it('a project-less request reads "-" for the project; the rendered text matches the template count', () => {
      const params = alertBodyParams('QUOTE_READY', { ...facts, projectName: null });
      expect(params[2]).toBe('-');
      const rendered = renderWhatsAppMessage('QUOTE_READY', params);
      expect(rendered).toBe(
        'Codsiga quotation-ka QR-00007 ee MR-00042 (mashruuca -): 3 quotation ayaa diyaar ah. Fadlan dooro dukaanka laga iibsanayo.',
      );
      for (const purpose of ['QUOTE_READY', 'QUOTE_REMINDER', 'QUOTE_ESCALATION', 'QUOTE_CHOSEN', 'QUOTE_ANOTHER'] as const) {
        const placeholders = WHATSAPP_TEMPLATE_BODIES[purpose].match(/\{\{\d+\}\}/g)!.length;
        expect(alertBodyParams(purpose, { ...facts, note: 'n', storeName: 's' })).toHaveLength(placeholders);
      }
    });
  });

  it('keys carry the round; a new send or a re-decision is a new round, a withdrawn award is not', () => {
    const sentAt = at('2026-10-10T05:00:00Z');
    const round = decisionRound({ sendCount: 2, sentAt });
    expect(round).toBe(`2.${sentAt.getTime()}`);
    const key = alertIdempotencyKey('qr1', 'QUOTE_REMINDER', round, 'u1');
    expect(key).toBe(`quotation-wa:qr1:QUOTE_REMINDER:${round}:u1`);
    expect(roundOfKey(key)).toBe(round);
    expect(roundOfKey('invoice-send:1')).toBeNull();
    expect(decisionRound({ sendCount: 3, sentAt })).not.toBe(round);
    expect(decisionRound({ sendCount: 2, sentAt: at('2026-10-10T06:00:00Z') })).not.toBe(round);
  });

  describe('isWithinWorkingHours', () => {
    it('Sat–Thu 07:00–17:00 Mogadishu only', () => {
      expect(isWithinWorkingHours(at('2026-10-10T04:00:00Z'))).toBe(true); // Sat 07:00
      expect(isWithinWorkingHours(at('2026-10-10T03:59:00Z'))).toBe(false); // Sat 06:59
      expect(isWithinWorkingHours(at('2026-10-10T13:59:00Z'))).toBe(true); // Sat 16:59
      expect(isWithinWorkingHours(at('2026-10-10T14:00:00Z'))).toBe(false); // Sat 17:00
      expect(isWithinWorkingHours(at('2026-10-09T08:00:00Z'))).toBe(false); // Friday 11:00
      expect(isWithinWorkingHours(at('2026-10-08T08:00:00Z'))).toBe(true); // Thursday 11:00
    });
  });

  describe('slaAlertsDue', () => {
    const waiting = (sentAt: string, urgent = false) => ({ status: 'AWAITING_DECISION', sentAt: at(sentAt), urgent });

    it('reminder at 2 working hours, escalation at 4', () => {
      // Sent Sat 08:00 local.
      expect(slaAlertsDue(waiting('2026-10-10T05:00:00Z'), at('2026-10-10T06:59:00Z'))).toMatchObject({ reminder: false, escalation: false });
      expect(slaAlertsDue(waiting('2026-10-10T05:00:00Z'), at('2026-10-10T07:00:00Z'))).toMatchObject({ reminder: true, escalation: false, waitingMinutes: 120 });
      expect(slaAlertsDue(waiting('2026-10-10T05:00:00Z'), at('2026-10-10T09:00:00Z'))).toMatchObject({ reminder: true, escalation: true });
    });

    it('the clock stops outside hours: sent Thu 16:00, reminder due only Sat 08:00', () => {
      const req = waiting('2026-10-08T13:00:00Z');
      expect(slaAlertsDue(req, at('2026-10-09T09:00:00Z')).reminder).toBe(false); // Friday: closed
      expect(slaAlertsDue(req, at('2026-10-10T04:59:00Z')).reminder).toBe(false); // Sat 07:59 = 119 min
      expect(slaAlertsDue(req, at('2026-10-10T05:00:00Z')).reminder).toBe(true); // Sat 08:00 = 120 min
    });

    it('a missed run does not chase a non-urgent request at night', () => {
      const req = waiting('2026-10-10T05:00:00Z');
      const night = at('2026-10-10T20:00:00Z'); // Sat 23:00
      expect(slaAlertsDue(req, night)).toMatchObject({ reminder: false, escalation: false, waitingMinutes: 540 });
    });

    it('urgent requests count clock hours, also out of hours', () => {
      const req = waiting('2026-10-09T08:00:00Z', true); // Friday
      expect(slaAlertsDue(req, at('2026-10-09T10:00:00Z'))).toMatchObject({ reminder: true, escalation: false });
      expect(slaAlertsDue(req, at('2026-10-09T12:00:00Z'))).toMatchObject({ reminder: true, escalation: true });
    });

    it('nothing once the request left AWAITING_DECISION or without a send', () => {
      for (const status of ['AWARD_PENDING_APPROVAL', 'AWARDED', 'RETURNED', 'CANCELLED', 'COLLECTING']) {
        expect(slaAlertsDue({ status, sentAt: at('2026-10-10T05:00:00Z'), urgent: true }, at('2026-10-10T12:00:00Z'))).toMatchObject({
          reminder: false,
          escalation: false,
        });
      }
      expect(slaAlertsDue({ status: 'AWAITING_DECISION', sentAt: null, urgent: false }, at('2026-10-10T12:00:00Z')).reminder).toBe(false);
    });
  });

  describe('alertStillWanted (dispatch guard)', () => {
    const sentAt = at('2026-10-10T05:00:00Z');
    const req = { status: 'AWAITING_DECISION', sendCount: 1, sentAt };
    const key = (purpose: Parameters<typeof alertIdempotencyKey>[1], round = decisionRound(req)) =>
      alertIdempotencyKey('qr1', purpose, round, 'u1');

    it('selector alerts only while awaiting a decision in the same round', () => {
      expect(alertStillWanted('QUOTE_REMINDER', key('QUOTE_REMINDER'), req)).toBeNull();
      expect(alertStillWanted('QUOTE_REMINDER', key('QUOTE_REMINDER'), { ...req, status: 'AWARD_PENDING_APPROVAL' })).toMatch(/decided/);
      expect(alertStillWanted('QUOTE_READY', key('QUOTE_READY'), { ...req, sendCount: 2 })).toMatch(/sent again/);
      expect(alertStillWanted('QUOTE_ESCALATION', key('QUOTE_ESCALATION'), { ...req, status: 'CANCELLED' })).toMatch(/cancelled/);
      expect(alertStillWanted('QUOTE_READY', key('QUOTE_READY'), null)).toMatch(/no longer exists/);
    });

    it('collector alerts only while the outcome still stands', () => {
      expect(alertStillWanted('QUOTE_CHOSEN', key('QUOTE_CHOSEN', '1'), { ...req, status: 'AWARDED' })).toBeNull();
      expect(alertStillWanted('QUOTE_CHOSEN', key('QUOTE_CHOSEN', '1'), req)).toMatch(/withdrawn/);
      expect(alertStillWanted('QUOTE_ANOTHER', key('QUOTE_ANOTHER', '1'), { ...req, status: 'RETURNED' })).toBeNull();
      expect(alertStillWanted('QUOTE_ANOTHER', key('QUOTE_ANOTHER', '1'), req)).toMatch(/sent again/);
    });
  });
});
