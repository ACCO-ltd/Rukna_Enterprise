import { BadRequestException } from '@nestjs/common';
import { PERMISSIONS } from '@erp/types';

import {
  ACTIVITY_MAX_LIMIT,
  ACTIVITY_ROUTES,
  decodeActivityCursor,
  describeActivityRow,
  encodeActivityCursor,
  parseActivityLimit,
  readableActivityFamilies,
  storedRouteForms,
} from './project-activity.js';

describe('project activity — pure rules (ADR-019 amendment 2026-09-28)', () => {
  describe('readableActivityFamilies', () => {
    it('a member with no extra permission reads project, team, documents and programme only', () => {
      expect([...readableActivityFamilies([PERMISSIONS.projectsView])].sort()).toEqual([
        'documents',
        'members',
        'programme',
        'project',
      ]);
    });

    it('contract events need view:contract and BOQ events need view:boq', () => {
      const families = readableActivityFamilies([
        PERMISSIONS.projectsView,
        PERMISSIONS.contractsView,
        PERMISSIONS.boqView,
      ]);
      expect(families.has('contract')).toBe(true);
      expect(families.has('boq')).toBe(true);
    });
  });

  describe('describeActivityRow', () => {
    it('an outbox row keeps its own command and resource type', () => {
      expect(
        describeActivityRow({ action: 'CREATE', resource: 'Contract', sourceCommand: 'contract.record-signed' }),
      ).toEqual({ command: 'contract.record-signed', resourceType: 'Contract' });
    });

    it('a request-logged row is named from the route catalogue, with or without the global prefix', () => {
      expect(
        describeActivityRow({
          action: 'POST',
          resource: '/api/v1/projects/:projectId/boq/versions/:versionId/commit',
          sourceCommand: null,
        }),
      ).toEqual({ command: 'boq.commit', resourceType: 'Boq' });
      expect(
        describeActivityRow({ action: 'POST', resource: '/projects/:id/members', sourceCommand: null }),
      ).toEqual({ command: 'project.addMember', resourceType: 'ProjectMember' });
    });

    it('the HTTP method disambiguates routes', () => {
      expect(
        describeActivityRow({ action: 'DELETE', resource: '/api/v1/projects/:id/members/:userId', sourceCommand: null })
          .command,
      ).toBe('project.removeMember');
    });
  });

  describe('route catalogue', () => {
    it('covers no route that writes an outbox row (nothing appears twice)', () => {
      const duplicated = [
        '/projects/:id/start',
        '/projects/:id/cancel',
        '/projects/:id/suspend',
        '/projects/:projectId/boq/extra-work',
        '/projects/:projectId/programme/baseline/approve',
        '/projects/:projectId/programme/baseline/rebaseline',
        '/projects/:projectId/documents',
      ];
      for (const route of duplicated) {
        expect(ACTIVITY_ROUTES.some((r) => r.route === route)).toBe(false);
      }
    });

    it('only catalogues routes whose id parameter is the project', () => {
      for (const r of ACTIVITY_ROUTES) {
        expect(r.route).toMatch(/^\/projects\/:(id|projectId)(\/|$)/);
        // The interceptor takes `:id` before `:projectId`; a nested `:id` would not be the project.
        const rest = r.route.replace(/^\/projects\/:(id|projectId)/, '');
        expect(rest).not.toMatch(/:id(\/|$)/);
      }
    });

    it('stores routes in both forms', () => {
      expect(storedRouteForms('/projects/:id')).toEqual(['/api/v1/projects/:id', '/projects/:id']);
    });
  });

  describe('paging', () => {
    it('limit defaults to 25, clamps at the max, rejects garbage', () => {
      expect(parseActivityLimit(undefined)).toBe(25);
      expect(parseActivityLimit('10')).toBe(10);
      expect(parseActivityLimit('1000')).toBe(ACTIVITY_MAX_LIMIT);
      expect(() => parseActivityLimit('0')).toThrow(BadRequestException);
      expect(() => parseActivityLimit('abc')).toThrow(BadRequestException);
      expect(() => parseActivityLimit('2.5')).toThrow(BadRequestException);
    });

    it('a cursor round-trips and a tampered one is a 400', () => {
      const cursor = { createdAt: new Date('2026-09-28T10:00:00.000Z'), id: 'audit-9' };
      expect(decodeActivityCursor(encodeActivityCursor(cursor))).toEqual(cursor);
      expect(decodeActivityCursor(undefined)).toBeNull();
      expect(() => decodeActivityCursor('not-a-cursor')).toThrow(BadRequestException);
      expect(() =>
        decodeActivityCursor(Buffer.from(JSON.stringify(['nope', 'x'])).toString('base64url')),
      ).toThrow(BadRequestException);
    });
  });
});
