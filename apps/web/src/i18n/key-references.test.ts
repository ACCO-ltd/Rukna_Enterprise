import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import arCommon from '../../messages/ar/common.json';
import arAccounting from '../../messages/ar/accounting.json';
import arAuth from '../../messages/ar/auth.json';
import arPlatform from '../../messages/ar/platform.json';
import arProcurement from '../../messages/ar/procurement.json';
import arDocuments from '../../messages/ar/documents.json';
import arProgress from '../../messages/ar/progress.json';
import enCommon from '../../messages/en/common.json';
import enAccounting from '../../messages/en/accounting.json';
import enAuth from '../../messages/en/auth.json';
import enPlatform from '../../messages/en/platform.json';
import enProcurement from '../../messages/en/procurement.json';
import enDocuments from '../../messages/en/documents.json';
import enProgress from '../../messages/en/progress.json';

/**
 * ─── Every key the code asks for exists in both catalogues ──────────────────────
 *
 * `catalogues.test.ts` proves en and ar agree with each other. It cannot prove either agrees
 * with the code, and `render.tsx` only catches a missing key on a branch some test actually
 * renders.
 *
 * That gap shipped a bug. `post-invoice-dialog.tsx` called `common.saving`, which did not
 * exist in either catalogue, on the branch that renders while a post is in flight — a branch
 * no test exercised. `next-intl` is configured to throw on a missing key, so clicking Post on
 * a client invoice threw as soon as the request started. It was found by a static sweep during
 * the Tier B build, not by the 996 tests that were passing at the time.
 *
 * This walks the source for `useTranslations(...)` bindings and checks every literal key
 * looked up through them. It is deliberately conservative: anything it cannot resolve
 * statically is skipped rather than guessed at, so a pass is weaker than it looks but a
 * failure is always real.
 */

const CATALOGUES: Record<string, { en: unknown; ar: unknown }> = {
  common: { en: enCommon, ar: arCommon },
  accounting: { en: enAccounting, ar: arAccounting },
  auth: { en: enAuth, ar: arAuth },
  platform: { en: enPlatform, ar: arPlatform },
  procurement: { en: enProcurement, ar: arProcurement },
  documents: { en: enDocuments, ar: arDocuments },
  progress: { en: enProgress, ar: arProgress },
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

function dig(obj: unknown, dotted: string): unknown {
  return dotted
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
      obj,
    );
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
  // whichever namespace happened to be seen last. That is the difference between a test that
  // reports real misses and one that reports noise nobody reads.
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

  it('resolves every one in English and Arabic', () => {
    const missing: string[] = [];

    for (const { file, namespace, key } of references) {
      const [root, ...rest] = namespace.split('.');
      const catalogue = CATALOGUES[root!];
      if (!catalogue) continue; // a namespace this test does not load

      const dotted = [...rest, key].join('.');
      if (dig(catalogue.en, dotted) === undefined) {
        missing.push(`${file}: EN ${namespace}.${key}`);
      } else if (dig(catalogue.ar, dotted) === undefined) {
        missing.push(`${file}: AR ${namespace}.${key}`);
      }
    }

    expect(missing).toEqual([]);
  });
});
