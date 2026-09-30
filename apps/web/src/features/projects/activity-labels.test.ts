import { describe, expect, it } from 'vitest';

import en from '../../../messages/en/platform.json';
import { activityEventKey, activityFallback } from './activity-labels';

const catalog = en.projects.activity;

function resolve(key: string): unknown {
  return key.split('.').reduce<unknown>(
    (node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
    catalog,
  );
}

const event = (command: string, action = 'UPDATE') => ({ action, sourceCommand: command, command });

describe('activity labels', () => {
  it.each([
    ['project.start', 'started the project'],
    ['project.addMember', 'added a team member'],
    ['contract.record-signed', 'executed the contract'],
    ['variation.raiseAndAdopt', 'added the extra work'],
    ['projectDocument.issueRevision', 'issued the revision'],
    ['programmeBaseline.approve', 'approved the programme baseline'],
    ['boq.commit', 'committed the BOQ'],
    ['commercial.recordProjectPayment', 'recorded the payment'],
    ['commercial.issuePackage', 'issued the invoice'],
  ])('%s has a catalog verb phrase', (command, label) => {
    expect(resolve(activityEventKey(event(command))!)).toBe(label);
  });

  it('every catalog entry is a lower-case verb phrase that can lead into a target', () => {
    const phrases = Object.values(catalog.events).flatMap((area) => Object.values(area));
    expect(phrases.length).toBeGreaterThan(50);
    for (const phrase of [...phrases, ...Object.values(catalog.fallback)]) {
      expect(phrase).toMatch(/^[a-z]/);
      expect(phrase).not.toMatch(/[.:]$/);
    }
  });

  it('labels a waiver by what it is, not by the command it unblocked', () => {
    expect(activityEventKey(event('project.start', 'WAIVE'))).toBe('events.project.conditionWaived');
  });

  it('gives no catalog key to a code that cannot be a catalog path', () => {
    expect(activityEventKey(event('/api/v1/projects/:id.post'))).toBeNull();
    expect(activityEventKey({ action: 'UPDATE', sourceCommand: null })).toBeNull();
  });

  it.each([
    [undefined, 'project'],
    ['Project', 'project'],
    ['ProjectMember', 'team'],
    ['Contract', 'contract'],
    ['ContractGuarantee', 'contract'],
    ['VariationOrder', 'variation'],
    ['ProjectDocumentRevision', 'document'],
    ['ProgrammeBaseline', 'programme'],
    ['WorkPackage', 'programme'],
    ['ProgressReport', 'progress'],
    ['Boq', 'boq'],
    ['Something', 'record'],
  ])('falls back from %s to the %s sentence', (resourceType, fallback) => {
    expect(activityFallback(resourceType)).toBe(fallback);
    expect(typeof catalog.fallback[fallback as keyof typeof catalog.fallback]).toBe('string');
  });
});
