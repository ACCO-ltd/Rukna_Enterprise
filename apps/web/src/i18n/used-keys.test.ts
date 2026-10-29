import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Every literal key the code asks for exists in the English catalogue.
 *
 * `renderWithProviders` throws on a missing key, but only for screens and branches a test
 * renders. Step 8 found three role labels and two P&L date labels that no test reached: in
 * production they rendered as dotted key paths. This reads the source instead.
 *
 * Scope: `const t = useTranslations('ns')` (or `getTranslations`) and calls `t('a.b')` with a
 * literal key. A variable declared with two namespaces in one file is skipped (it is scoped per
 * function); template-literal keys and comments are not checked.
 */

const root = join(__dirname, '..');
const messagesDir = join(__dirname, '..', '..', 'messages', 'en');

function catalogue(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const file of readdirSync(messagesDir)) {
    if (!file.endsWith('.json')) continue;
    // The namespace is the file name in camelCase (project-types.json → projectTypes), as
    // `src/i18n/request.ts` mounts them.
    const name = file.slice(0, -5).replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
    out[name] = JSON.parse(readFileSync(join(messagesDir, file), 'utf8'));
  }
  return out;
}

function has(tree: Record<string, unknown>, path: string): boolean {
  let cur: unknown = tree;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object' || !(part in (cur as object))) return false;
    cur = (cur as Record<string, unknown>)[part];
  }
  return true;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

/** Drops block and line comments, so `@example` snippets are not read as calls. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

describe('message keys used in code', () => {
  it('exist in the English catalogue', () => {
    const messages = catalogue();
    const missing: string[] = [];
    for (const file of sourceFiles(root)) {
      const source = stripComments(readFileSync(file, 'utf8'));
      const namespaces = new Map<string, Set<string>>();
      for (const m of source.matchAll(/(?:const|let) (\w+) = (?:await )?(?:useTranslations|getTranslations)\(\s*'([^']*)'/g)) {
        const set = namespaces.get(m[1]!) ?? new Set<string>();
        set.add(m[2]!);
        namespaces.set(m[1]!, set);
      }
      for (const [variable, set] of namespaces) {
        if (set.size !== 1) continue;
        const ns = [...set][0]!;
        if (!ns) continue;
        for (const call of source.matchAll(new RegExp(`\\b${variable}(?:\\.rich|\\.raw|\\.has)?\\(\\s*'([^'$]+)'`, 'g'))) {
          const key = call[1]!;
          if (key.includes('{')) continue;
          if (!has(messages, `${ns}.${key}`)) {
            const line = source.slice(0, call.index).split('\n').length;
            missing.push(`${relative(root, file)}:${line} ${ns}.${key}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
