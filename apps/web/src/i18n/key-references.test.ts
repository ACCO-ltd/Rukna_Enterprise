import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ─── The code's translation-key references are discoverable ─────────────────────
 *
 * `render.tsx` is configured to throw on a missing key, so a component that asks for a key the
 * catalogue does not define fails the test that renders it. This companion check walks the
 * source for `useTranslations(...)` bindings so a broken key matcher cannot pass silently — if
 * this suddenly finds far fewer references, the guard the render tests rely on has rotted.
 *
 * It is deliberately conservative: anything it cannot resolve statically is skipped rather than
 * guessed at.
 */

const SRC = join(__dirname, '..');

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, acc);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) acc.push(path);
  }
  return acc;
}

interface Reference {
  file: string;
  namespace: string;
  key: string;
}

/**
 * Removes block and line comments.
 *
 * Without this, a JSDoc usage example counts as a call site — `platform-data-grid.tsx`
 * documents itself with `t('columns.ref')` and `t('title')` in a `@example` block, none of
 * which the component ever calls.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function referencesIn(rawSource: string, file: string): Reference[] {
  const source = stripComments(rawSource);

  // `const t = useTranslations('procurement.supplier')` → { t: ['procurement.supplier'] }
  //
  // A name can be bound more than once in one file — two components each doing
  // `const t = useTranslations(...)` against different namespaces. Scope is not tracked here,
  // so when a name is ambiguous the whole binding is dropped rather than resolved against
  // whichever namespace happened to be seen last.
  const bindings = new Map<string, Set<string>>();
  for (const match of source.matchAll(
    /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*'([\w.]+)'\s*\)/g,
  )) {
    const seen = bindings.get(match[1]!) ?? new Set<string>();
    seen.add(match[2]!);
    bindings.set(match[1]!, seen);
  }

  const unambiguous = new Map<string, string>();
  for (const [variable, namespaces] of bindings) {
    if (namespaces.size === 1) unambiguous.set(variable, [...namespaces][0]!);
  }

  const found: Reference[] = [];
  for (const [variable, namespace] of unambiguous) {
    // The leading boundary matters: without it, `form.get('code')` matches a binding named `t`.
    const call = new RegExp(`(?<![\\w.$])${variable}\\(\\s*'([\\w.-]+)'\\s*[,)]`, 'g');
    for (const match of source.matchAll(call)) {
      found.push({ file, namespace, key: match[1]! });
    }
  }
  return found;
}

describe('translation keys referenced in source', () => {
  const references = sourceFiles(SRC).flatMap((file) =>
    referencesIn(readFileSync(file, 'utf8'), file.slice(SRC.length + 1)),
  );

  it('finds a meaningful number of references, so a broken matcher cannot pass silently', () => {
    expect(references.length).toBeGreaterThan(300);
  });
});
