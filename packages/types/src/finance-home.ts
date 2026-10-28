// ─── Finance Home (Step 4, ADR-047 §4) ────────────────────────────────────
// `GET /finance/home` — the finance team's dashboard. Each section is present only for a caller who
// may read it (null otherwise). Amounts are decimal strings in the base currency (ADR-024: USD).

export type AgingBucketKey = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus';

export interface AgingBucket {
  key: AgingBucketKey;
  amount: string;
  count: number;
}

export interface FinanceHomeCash {
  total: string;
  accounts: Array<{ bankAccountId: string; bankName: string; accountName: string; balance: string }>;
}

export interface FinanceHomeReceivables {
  outstanding: string;
  overdue: string;
  /** Unpaid issued invoices by days past due; `current` = not yet due. */
  aging: AgingBucket[];
  /** The clients owing the most overdue money, largest first (at most 5). */
  topOverdue: Array<{ clientId: string; clientName: string; overdue: string; oldestDaysLate: number }>;
}

export interface FinanceHomePayables {
  outstanding: string;
  overdue: string;
  /** Bills falling due in the next 7 days (not yet overdue). */
  dueThisWeek: string;
  dueThisWeekCount: number;
}

export interface FinanceHomeMonth {
  /** First and last day of the current month (YYYY-MM-DD). */
  from: string;
  to: string;
  invoiced: string;
  collected: string;
  paid: string;
}

export interface FinanceHome {
  asOf: string;
  cash: FinanceHomeCash | null;
  receivables: FinanceHomeReceivables | null;
  payables: FinanceHomePayables | null;
  month: FinanceHomeMonth | null;
}
