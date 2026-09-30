import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import accounting from '../../messages/en/accounting.json';
import auth from '../../messages/en/auth.json';
import commercial from '../../messages/en/commercial.json';
import common from '../../messages/en/common.json';
import documents from '../../messages/en/documents.json';
import finance from '../../messages/en/finance.json';
import notifications from '../../messages/en/notifications.json';
import platform from '../../messages/en/platform.json';
import procurement from '../../messages/en/procurement.json';
import progress from '../../messages/en/progress.json';
import projectTypes from '../../messages/en/project-types.json';

/**
 * Mutation feedback keys (`meta.successToast` / `meta.successDialog`) are plain strings resolved
 * at runtime by the root translator, so no `useTranslations` binding covers them. Convention:
 * every one lives under `<namespace>.feedback.*`. This walks the source for such literals and
 * fails on any the catalogue does not define — otherwise a typo would surface only as a toast
 * reading "accounting.feedback.jounralSaved" in production.
 */

const CATALOGUE: Record<string, unknown> = {
  accounting,
  auth,
  commercial,
  common,
  documents,
  finance,
  notifications,
  platform,
  procurement,
  progress,
  projectTypes,
};

const SRC = join(__dirname, '..');

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, acc);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) acc.push(path);
  }
  return acc;
}

function lookup(path: string): unknown {
  return path.split('.').reduce<unknown>((node, part) => {
    if (node && typeof node === 'object' && part in node) return (node as Record<string, unknown>)[part];
    return undefined;
  }, CATALOGUE);
}

/** Comments hold usage examples, not call sites. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const KEY = /'(\w+\.(?:[\w]+\.)*feedback\.[\w.]+)'/g;

describe('mutation feedback keys', () => {
  const references = sourceFiles(SRC).flatMap((file) =>
    [...stripComments(readFileSync(file, 'utf8')).matchAll(KEY)].map((m) => ({ file, key: m[1]! })),
  );

  it('every <namespace>.feedback.* key the source names exists in the catalogue', () => {
    const missing = references.filter((r) => typeof lookup(r.key) !== 'string');
    expect(missing.map((r) => `${r.key} (${r.file.slice(SRC.length)})`)).toEqual([]);
  });
});
