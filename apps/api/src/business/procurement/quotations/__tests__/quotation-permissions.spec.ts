import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PERMISSION_DEFINITIONS, PERMISSIONS } from '@erp/types';

import { GOVERNED_SYSTEM_ROLES } from '../../../../../scripts/governed-roles.js';
import { QUOTATION_GRANTS } from '../../../../../prisma/seeds/quotation-permissions.js';

/**
 * ADR-044 §5 — the two quotation permissions: catalogue entries, risk classes, and who the seeds
 * give them to (product owner 2026-10-07: the Construction Director does NOT get award:quotation).
 */

const SEED = join(__dirname, '../../../../../prisma/seeds/acco-team-roles.seed.ts');

function seededPermissions(roleName: string): string[] {
  const seed = readFileSync(SEED, 'utf8');
  const start = seed.indexOf(`name: '${roleName}'`);
  expect(start).toBeGreaterThan(-1);
  const end = seed.indexOf('\n  },', start);
  return [...seed.slice(start, end).matchAll(/P\.(\w+)/g)].map(
    (m) => PERMISSIONS[m[1] as keyof typeof PERMISSIONS],
  );
}

const governed = (name: string) =>
  GOVERNED_SYSTEM_ROLES.find((r) => r.name === name)!.permissions as readonly string[];

describe('ADR-044 quotation permissions', () => {
  it('are in the catalogue with descriptions, the Procurement domain and the ADR risk classes', () => {
    const collect = PERMISSION_DEFINITIONS.find((d) => d.key === 'collect:quotation');
    const award = PERMISSION_DEFINITIONS.find((d) => d.key === 'award:quotation');
    expect(collect).toMatchObject({ action: 'collect', resource: 'quotation', domain: 'Procurement', riskClass: 'MEDIUM' });
    expect(award).toMatchObject({ action: 'award', resource: 'quotation', domain: 'Procurement', riskClass: 'CRITICAL' });
    expect(collect!.description).toMatch(/no prices/);
    expect(award!.description).toMatch(/award/);
    expect(PERMISSIONS.quotationsCollect).toBe('collect:quotation');
    expect(PERMISSIONS.quotationsAward).toBe('award:quotation');
  });

  it('team-role seed: Procurement Manager collects, Finance Officer awards, Construction Director neither awards', () => {
    expect(seededPermissions('Procurement Manager')).toContain('collect:quotation');
    expect(seededPermissions('Procurement Manager')).not.toContain('award:quotation');
    expect(seededPermissions('Finance Officer')).toContain('award:quotation');
    expect(seededPermissions('Finance Officer')).not.toContain('collect:quotation');
    expect(seededPermissions('Construction Director')).not.toContain('award:quotation');
    expect(seededPermissions('Project Manager')).not.toContain('award:quotation');
    expect(seededPermissions('Site Engineer')).not.toContain('collect:quotation');
  });

  it('governed roles: CFO and CEO award; neither collects', () => {
    for (const name of ['CFO', 'CEO']) {
      expect(governed(name)).toContain('award:quotation');
      expect(governed(name)).not.toContain('collect:quotation');
    }
  });

  it('the targeted live-tenant grant matches the seeds exactly', () => {
    expect(QUOTATION_GRANTS.map((g) => `${g.roleName}=${g.permission}`).sort()).toEqual(
      [
        'CEO=award:quotation',
        'CFO=award:quotation',
        'Finance Officer=award:quotation',
        'Procurement Manager=collect:quotation',
      ].sort(),
    );
  });
});
