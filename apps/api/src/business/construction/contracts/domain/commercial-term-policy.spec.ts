import type { ContractStatus } from '@prisma/client';

import { CommercialTermPolicy, type CommercialMutationKind } from './commercial-term-policy.js';

const SUBSTANTIVE: CommercialMutationKind[] = [
  'CONTRACT_HEADER',
  'RETENTION_TERMS',
  'ADVANCE_TERM',
  'GUARANTEE_TERM',
  'MILESTONE_TERM',
];

const ALL_STATUSES: ContractStatus[] = [
  'DRAFT',
  'UNDER_REVIEW',
  'PENDING_SIGNATURE',
  'ACTIVE',
  'FINAL_ACCOUNT_PENDING',
  'CLOSED',
  'CANCELLED',
  'TERMINATED',
];

describe('CommercialTermPolicy — substantive baseline mutations (CONST-COM-001)', () => {
  it('allows every substantive mutation only in DRAFT', () => {
    for (const kind of SUBSTANTIVE) {
      expect(CommercialTermPolicy.evaluate('DRAFT', kind).allowed).toBe(true);
    }
  });

  it('blocks every substantive mutation once the contract leaves DRAFT', () => {
    for (const kind of SUBSTANTIVE) {
      for (const status of ALL_STATUSES.filter((s) => s !== 'DRAFT')) {
        const decision = CommercialTermPolicy.evaluate(status, kind);
        expect(decision.allowed).toBe(false);
        expect(decision.reason).toBeDefined();
      }
    }
  });

  it('reports UNDER_REVIEW distinctly from terminal and frozen', () => {
    expect(CommercialTermPolicy.evaluate('UNDER_REVIEW', 'RETENTION_TERMS').reason).toBe(
      'CONTRACT_UNDER_REVIEW',
    );
    expect(CommercialTermPolicy.evaluate('ACTIVE', 'RETENTION_TERMS').reason).toBe(
      'CONTRACT_BASELINE_FROZEN',
    );
    expect(CommercialTermPolicy.evaluate('TERMINATED', 'RETENTION_TERMS').reason).toBe(
      'CONTRACT_TERMINAL',
    );
  });
});

describe('CommercialTermPolicy — guarantee status (operational exception)', () => {
  it('is allowed in every non-terminal status', () => {
    for (const status of ['DRAFT', 'UNDER_REVIEW', 'PENDING_SIGNATURE', 'ACTIVE', 'FINAL_ACCOUNT_PENDING'] as ContractStatus[]) {
      expect(CommercialTermPolicy.evaluate(status, 'GUARANTEE_STATUS').allowed).toBe(true);
    }
  });

  it('is blocked in terminal statuses', () => {
    for (const status of ['CLOSED', 'CANCELLED', 'TERMINATED'] as ContractStatus[]) {
      const d = CommercialTermPolicy.evaluate(status, 'GUARANTEE_STATUS');
      expect(d.allowed).toBe(false);
      expect(d.reason).toBe('CONTRACT_TERMINAL');
    }
  });
});

describe('CommercialTermPolicy — milestone completion (operational)', () => {
  it('is allowed only while the contract is executing', () => {
    expect(CommercialTermPolicy.evaluate('ACTIVE', 'MILESTONE_COMPLETE').allowed).toBe(true);
    expect(CommercialTermPolicy.evaluate('FINAL_ACCOUNT_PENDING', 'MILESTONE_COMPLETE').allowed).toBe(
      true,
    );
  });

  it('is blocked before execution and in terminal statuses', () => {
    expect(CommercialTermPolicy.evaluate('DRAFT', 'MILESTONE_COMPLETE').reason).toBe(
      'CONTRACT_NOT_EXECUTING',
    );
    expect(CommercialTermPolicy.evaluate('TERMINATED', 'MILESTONE_COMPLETE').reason).toBe(
      'CONTRACT_TERMINAL',
    );
  });
});

describe('CommercialTermPolicy.isTerminal', () => {
  it('recognises terminal statuses', () => {
    expect(CommercialTermPolicy.isTerminal('CLOSED')).toBe(true);
    expect(CommercialTermPolicy.isTerminal('CANCELLED')).toBe(true);
    expect(CommercialTermPolicy.isTerminal('TERMINATED')).toBe(true);
    expect(CommercialTermPolicy.isTerminal('ACTIVE')).toBe(false);
  });
});
