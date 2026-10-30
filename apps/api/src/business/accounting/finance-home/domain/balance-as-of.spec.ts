import { Decimal } from '@prisma/client/runtime/library';

import { balanceOn, existedOn, type DatedDocument } from './balance-as-of';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const m = (amount: number, date: string, reversedOn: string | null = null) => ({
  amount: new Decimal(amount),
  date: d(date),
  reversedOn: reversedOn ? d(reversedOn) : null,
});

describe('balance on a past day (AG-1)', () => {
  // Invoice of 1,000 posted 1 Sep; 400 paid 15 Sep; 100 credited 10 Oct; a 50 payment on 20 Sep
  // bounced on 5 Oct. Today 600 − 100 = 500 is open... (1000 − 400 − 100 = 500).
  const invoice: DatedDocument = {
    total: new Decimal(1000),
    openNow: new Decimal(500),
    postedOn: d('2026-09-01'),
    reversedOn: null,
    movements: [m(400, '2026-09-15'), m(100, '2026-10-10'), m(50, '2026-09-20', '2026-10-05')],
  };

  it('did not exist before it was posted', () => {
    expect(balanceOn(invoice, d('2026-08-31'))).toBeNull();
  });

  it('counts only what had happened by that day, and a bounced payment while it stood', () => {
    expect(balanceOn(invoice, d('2026-09-01'))!.toFixed(2)).toBe('1000.00');
    expect(balanceOn(invoice, d('2026-09-30'))!.toFixed(2)).toBe('550.00'); // 1000 − 400 − 50
    expect(balanceOn(invoice, d('2026-10-06'))!.toFixed(2)).toBe('600.00'); // the 50 bounced
    expect(balanceOn(invoice, d('2026-10-30'))!.toFixed(2)).toBe('500.00'); // today
  });

  it('a document reversed later stood until then, at its total less what counted', () => {
    const reversed: DatedDocument = { ...invoice, openNow: new Decimal(0), reversedOn: d('2026-10-20'), movements: [m(400, '2026-09-15', '2026-10-20')] };
    expect(balanceOn(reversed, d('2026-09-30'))!.toFixed(2)).toBe('600.00');
    expect(existedOn(reversed, d('2026-10-20'))).toBe(false);
    expect(balanceOn(reversed, d('2026-10-25'))).toBeNull();
  });
});
