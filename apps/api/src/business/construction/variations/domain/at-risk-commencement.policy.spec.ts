import { Decimal } from '@prisma/client/runtime/library';

import { AtRiskCommencementPolicy } from './at-risk-commencement.policy.js';

describe('AtRiskCommencementPolicy (ADR-026 CONST-VAR-011, Route 7B)', () => {
  describe('eligible', () => {
    it('permits the pre-CLIENT_APPROVED live states', () => {
      expect(AtRiskCommencementPolicy.eligible('DRAFT')).toBe(true);
      expect(AtRiskCommencementPolicy.eligible('PENDING_INTERNAL')).toBe(true);
      expect(AtRiskCommencementPolicy.eligible('INTERNAL_APPROVED')).toBe(true);
    });

    it('rejects CLIENT_APPROVED (work is now sanctioned normally) and the terminal states', () => {
      expect(AtRiskCommencementPolicy.eligible('CLIENT_APPROVED')).toBe(false);
      expect(AtRiskCommencementPolicy.eligible('REJECTED')).toBe(false);
      expect(AtRiskCommencementPolicy.eligible('WITHDRAWN')).toBe(false);
    });
  });

  describe('requiredSignatories (the OQ-1 cap rule)', () => {
    const cap = new Decimal('25000');

    it('below the cap: CD + CFO only, no CEO', () => {
      const r = AtRiskCommencementPolicy.requiredSignatories(new Decimal('18000'), cap);
      expect(r.ceoRequired).toBe(false);
      expect(r.requiredRoles).toEqual(['CONSTRUCTION_DIRECTOR', 'CFO']);
    });

    it('exactly at the cap: still CD + CFO (cap is inclusive — CEO only strictly above)', () => {
      const r = AtRiskCommencementPolicy.requiredSignatories(new Decimal('25000'), cap);
      expect(r.ceoRequired).toBe(false);
      expect(r.requiredRoles).toEqual(['CONSTRUCTION_DIRECTOR', 'CFO']);
    });

    it('above the cap: adds the CEO', () => {
      const r = AtRiskCommencementPolicy.requiredSignatories(new Decimal('25000.01'), cap);
      expect(r.ceoRequired).toBe(true);
      expect(r.requiredRoles).toEqual(['CONSTRUCTION_DIRECTOR', 'CFO', 'CEO']);
    });

    it('honours a different (config-driven) cap value', () => {
      const r = AtRiskCommencementPolicy.requiredSignatories(new Decimal('40000'), new Decimal('50000'));
      expect(r.ceoRequired).toBe(false);
    });
  });
});
