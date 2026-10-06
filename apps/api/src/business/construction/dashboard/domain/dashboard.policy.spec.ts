import { Decimal } from '@prisma/client/runtime/library';
import { PERMISSIONS, type DashboardTodoItem } from '@erp/types';

import {
  buildFigures,
  buildSetupSteps,
  byEarliestNeed,
  byMostLate,
  dashboardAgingKey,
  decideStage,
  moneyOrNull,
  preparationProgress,
  rankTodo,
  TODO_CAP_PER_KIND,
} from './dashboard.policy.js';

const d = (v: number | string) => new Decimal(v);
const TODAY = new Date('2026-10-06T10:00:00Z');
const daysAgo = (n: number) => new Date(Date.UTC(2026, 9, 6 - n));

describe('decideStage (P32 — decided on the organisation)', () => {
  it('NEW with no project, or only cancelled ones', () => {
    expect(decideStage({})).toBe('NEW');
    expect(decideStage({ CANCELLED: 3 })).toBe('NEW');
  });

  it('PREPARATION while every live project is a draft', () => {
    expect(decideStage({ DRAFT: 2 })).toBe('PREPARATION');
    expect(decideStage({ DRAFT: 1, CANCELLED: 4 })).toBe('PREPARATION');
  });

  it('RUNNING once any project has started — even if it has since closed', () => {
    expect(decideStage({ DRAFT: 5, ACTIVE: 1 })).toBe('RUNNING');
    expect(decideStage({ CLOSEOUT: 1 })).toBe('RUNNING');
    expect(decideStage({ DRAFT: 1, CLOSED: 1 })).toBe('RUNNING');
    expect(decideStage({ PRACTICAL_COMPLETION: 1 })).toBe('RUNNING');
  });
});

describe('preparationProgress — the next step in checklist order', () => {
  it('counts done/total and picks the first open condition by PREPARATION_STEP_ORDER, not server order', () => {
    const result = preparationProgress([
      { code: 'ACTIVE_MAIN_CONTRACT', satisfied: false },
      { code: 'CLIENT_ACTIVE', satisfied: true },
      { code: 'BOQ_BASELINED', satisfied: false },
      { code: 'DELIVERY_TEAM', satisfied: true },
    ]);
    expect(result.readiness).toEqual({ done: 2, total: 4 });
    expect(result.nextStep).toEqual({ code: 'BOQ_BASELINED', owner: 'quantitySurveyor' });
  });

  it('owner follows PREPARATION_STEP_OWNER', () => {
    expect(
      preparationProgress([{ code: 'CONTRACT_START_DATE', satisfied: false }]).nextStep,
    ).toEqual({
      code: 'CONTRACT_START_DATE',
      owner: 'commercialTeam',
    });
  });

  it('an unknown code sorts after every known one', () => {
    const result = preparationProgress([
      { code: 'SOMETHING_NEW', satisfied: false },
      { code: 'PROGRAMME_DATES', satisfied: false },
    ]);
    expect(result.nextStep?.code).toBe('PROGRAMME_DATES');
    expect(preparationProgress([{ code: 'SOMETHING_NEW', satisfied: false }]).nextStep).toEqual({
      code: 'SOMETHING_NEW',
      owner: 'projectManager',
    });
  });

  it('null next step when everything is satisfied', () => {
    expect(preparationProgress([{ code: 'CLIENT_ACTIVE', satisfied: true }]).nextStep).toBeNull();
    expect(preparationProgress([]).readiness).toEqual({ done: 0, total: 0 });
  });
});

describe('dashboardAgingKey — four columns, 61–90 and 90+ folded into over60', () => {
  it.each([
    ['NOT_DUE', 'notDue'],
    ['DAYS_1_30', 'days1To30'],
    ['DAYS_31_60', 'days31To60'],
    ['DAYS_61_90', 'over60'],
    ['DAYS_90_PLUS', 'over60'],
  ] as const)('%s → %s', (bucket, key) => expect(dashboardAgingKey(bucket)).toBe(key));
});

describe('buildFigures', () => {
  it('is empty when nothing is active, owed or payable', () => {
    expect(
      buildFigures({ today: TODAY, activeProjects: [], openInvoices: [], openBills: [] }),
    ).toEqual([]);
  });

  it('one entry per currency; receivables, aging and payables never cross currencies', () => {
    const figures = buildFigures({
      today: TODAY,
      activeProjects: [
        { currency: 'USD', contractValue: d(1000), contractCurrency: 'USD' },
        { currency: 'USD', contractValue: null, contractCurrency: null }, // no recorded contract
        { currency: 'SOS', contractValue: d(5), contractCurrency: 'SOS' },
      ],
      openInvoices: [
        {
          currencyCode: 'USD',
          totalAmount: d(100),
          outstandingAmount: d(100),
          dueDate: daysAgo(-3),
        }, // not due
        { currencyCode: 'USD', totalAmount: d(50), outstandingAmount: d(40), dueDate: daysAgo(0) }, // due today: not late
        { currencyCode: 'USD', totalAmount: d(30), outstandingAmount: d(30), dueDate: daysAgo(30) }, // 1–30
        { currencyCode: 'USD', totalAmount: d(20), outstandingAmount: d(20), dueDate: daysAgo(31) }, // 31–60
        { currencyCode: 'USD', totalAmount: d(10), outstandingAmount: d(10), dueDate: daysAgo(61) }, // over 60
        { currencyCode: 'USD', totalAmount: d(5), outstandingAmount: d(5), dueDate: daysAgo(120) }, // over 60
        { currencyCode: 'SOS', totalAmount: d(7), outstandingAmount: d(7), dueDate: null },
      ],
      openBills: [
        { currencyCode: 'USD', outstandingAmount: d(200), dueDate: daysAgo(-7) }, // due in 7 days: this week
        { currencyCode: 'USD', outstandingAmount: d(300), dueDate: daysAgo(-8) }, // next week
        { currencyCode: 'USD', outstandingAmount: d(400), dueDate: daysAgo(10) }, // overdue: counts
      ],
    });

    expect(figures.map((f) => f.currency)).toEqual(['SOS', 'USD']);
    const usd = figures[1]!;
    expect(usd.contractValueInProgress).toBe('1000.00');
    expect(usd.activeProjectCount).toBe(2);
    expect(usd.receivables).toEqual({
      outstanding: '205.00',
      unpaidInvoiceCount: 6,
      overdue: '65.00',
      overdueInvoiceCount: 4,
      oldestDaysLate: 120,
      aging: { notDue: '140.00', days1To30: '30.00', days31To60: '20.00', over60: '15.00' },
    });
    expect(usd.payables).toEqual({
      outstanding: '900.00',
      unpaidBillCount: 3,
      dueThisWeek: '600.00',
    });

    const sos = figures[0]!;
    expect(sos.contractValueInProgress).toBe('5.00');
    expect(sos.receivables.overdue).toBe('0.00');
    expect(sos.receivables.oldestDaysLate).toBeNull();
    expect(sos.receivables.aging.notDue).toBe('7.00');
    expect(sos.payables).toEqual({ outstanding: '0.00', unpaidBillCount: 0, dueThisWeek: '0.00' });
  });
});

function item(
  kind: DashboardTodoItem['kind'],
  tone: DashboardTodoItem['tone'],
  key: string,
): DashboardTodoItem {
  return {
    kind,
    tone,
    key,
    href: '/',
    amount: null,
    currency: null,
  } as unknown as DashboardTodoItem;
}

describe('rankTodo', () => {
  it('danger → attention → neutral, kind order within a tone, input order within a kind', () => {
    const ranked = rankTodo([
      item('PROJECTS_WITHOUT_CONTRACT', 'neutral', 'pwc'),
      item('REPORTS_TO_REVIEW', 'neutral', 'r1'),
      item('ACCOUNTING_SETUP_INCOMPLETE', 'attention', 'acc'),
      item('MATERIAL_REQUEST_AWAITING_APPROVAL', 'attention', 'mr1'),
      item('INVOICE_OVERDUE', 'danger', 'inv-b'),
      item('INVOICE_OVERDUE', 'danger', 'inv-a'),
      item('STAGE_READY_TO_BILL', 'neutral', 's1'),
      item('BILL_MATCH_EXCEPTION', 'attention', 'bme'),
    ]);
    expect(ranked.map((i) => i.key)).toEqual([
      'inv-b',
      'inv-a',
      'mr1',
      'bme',
      'acc',
      'r1',
      's1',
      'pwc',
    ]);
  });

  it(`caps per-record kinds at ${TODO_CAP_PER_KIND}; aggregated and per-project kinds are not cut`, () => {
    const many = Array.from({ length: 8 }, (_, i) => item('INVOICE_OVERDUE', 'danger', `inv${i}`));
    const reports = Array.from({ length: 7 }, (_, i) =>
      item('REPORTS_TO_REVIEW', 'neutral', `r${i}`),
    );
    const ranked = rankTodo([...many, ...reports]);
    expect(ranked.filter((i) => i.kind === 'INVOICE_OVERDUE').map((i) => i.key)).toEqual([
      'inv0',
      'inv1',
      'inv2',
      'inv3',
      'inv4',
    ]);
    expect(ranked.filter((i) => i.kind === 'REPORTS_TO_REVIEW')).toHaveLength(7);
  });
});

describe('row orders', () => {
  it('overdue invoices: most days late first', () => {
    const rows = [
      { daysLate: 3, invoiceNumber: 'B' },
      { daysLate: 40, invoiceNumber: 'C' },
      { daysLate: 3, invoiceNumber: 'A' },
    ].sort(byMostLate);
    expect(rows.map((r) => r.invoiceNumber)).toEqual(['C', 'A', 'B']);
  });

  it('material requests: earliest need first, undated last', () => {
    const rows = [
      { requiredByDate: null, mrNumber: 'MR-1' },
      { requiredByDate: '2026-10-20', mrNumber: 'MR-2' },
      { requiredByDate: '2026-10-08', mrNumber: 'MR-3' },
    ].sort(byEarliestNeed);
    expect(rows.map((r) => r.mrNumber)).toEqual(['MR-3', 'MR-2', 'MR-1']);
  });
});

describe('buildSetupSteps', () => {
  const facts = {
    clientCount: 1,
    projectCount: 0,
    accountingReady: false,
    supplierCount: 2,
    materialCount: 0,
    activeUserCount: 1,
  };

  it('done follows the facts; suppliers need a supplier AND a catalogue material; team needs a second user', () => {
    const steps = buildSetupSteps(facts, []);
    expect(steps.map((s) => [s.code, s.done, s.optional])).toEqual([
      ['CLIENT', true, false],
      ['PROJECT', false, false],
      ['ACCOUNTING', false, false],
      ['SUPPLIERS', false, true],
      ['TEAM', false, false],
    ]);
    expect(
      buildSetupSteps({ ...facts, materialCount: 1, activeUserCount: 2 }, [])
        .filter((s) => s.done)
        .map((s) => s.code),
    ).toEqual(['CLIENT', 'SUPPLIERS', 'TEAM']);
  });

  it('canAct follows the permission each step needs', () => {
    const steps = buildSetupSteps(facts, [PERMISSIONS.clientsCreate, PERMISSIONS.payablesManage]);
    expect(Object.fromEntries(steps.map((s) => [s.code, s.canAct]))).toEqual({
      CLIENT: true,
      PROJECT: false,
      ACCOUNTING: false,
      SUPPLIERS: true,
      TEAM: false,
    });
  });
});

describe('moneyOrNull', () => {
  it('hidden money is null, never "0.00"', () => {
    expect(moneyOrNull(false, d(0))).toBeNull();
    expect(moneyOrNull(true, d(0))).toBe('0.00');
    expect(moneyOrNull(true, null)).toBeNull();
  });
});
