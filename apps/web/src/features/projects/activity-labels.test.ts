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
    ['project.start', 'Project started'],
    ['project.addMember', 'Team member added'],
    ['contract.record-signed', 'Signed contract recorded'],
    ['variation.raiseAndAdopt', 'Extra work added'],
    ['projectDocument.issueRevision', 'Document revision issued'],
    ['programmeBaseline.approve', 'Programme baseline approved'],
    ['boq.commit', 'BOQ committed'],
    ['commercial.recordProjectPayment', 'Payment recorded'],
  ])('%s has a catalog label', (command, label) => {
    expect(resolve(activityEventKey(event(command))!)).toBe(label);
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
