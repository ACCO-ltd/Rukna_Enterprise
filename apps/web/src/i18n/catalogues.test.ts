import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Structural guarantees about the message catalogues themselves.
 *
 * These exist because of a real failure. A rebase merged `platform.json` without reporting a
 * conflict and left the file with **two** top-level `"ipc"` keys. `JSON.parse` keeps the last
 * of a duplicate pair, so 54 lines of translations were silently discarded — and because
 * `renderWithProviders` throws on a missing key, the tests that should have caught it failed
 * with "missing message" on strings that were sitting in the file the whole time.
 *
 * A JSON file with a duplicate key is still valid JSON. Nothing else in the toolchain looks
 * for this.
 */

const LOCALES = ['en'] as const;
const NAMESPACES = ['common', 'auth', 'platform', 'accounting', 'procurement', 'commercial', 'documents', 'progress', 'project-types'] as const;

const messagesDir = join(__dirname, '..', '..', 'messages');

function read(locale: string, namespace: string): string {
  return readFileSync(join(messagesDir, locale, `${namespace}.json`), 'utf8');
}

/** Every key path in an object, dotted. Leaves only — the shape matters, not the values. */
function keyPaths(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [prefix];

  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    keyPaths(v, prefix ? `${prefix}.${k}` : k),
  );
}

/**
 * Duplicate keys at any depth, found by walking the raw text.
 *
 * `JSON.parse` cannot report this — it silently keeps the last occurrence — so the source has
 * to be scanned. Tracks a stack of sibling sets, one per object depth, skipping over string
 * literals so that a brace or a quote inside a translated sentence does not shift the depth.
 */
function duplicateKeys(source: string): string[] {
  const duplicates: string[] = [];
  const stack: Set<string>[] = [];

  let i = 0;
  while (i < source.length) {
    const char = source[i];

    if (char === '"') {
      let j = i + 1;
      let literal = '';
      while (j < source.length) {
        if (source[j] === '\\') {
          literal += source[j + 1];
          j += 2;
          continue;
        }
        if (source[j] === '"') break;
        literal += source[j];
        j++;
      }

      // A string is a key only when the next non-space character is a colon.
      let k = j + 1;
      while (k < source.length && /\s/.test(source[k]!)) k++;

      if (source[k] === ':' && stack.length > 0) {
        const siblings = stack[stack.length - 1]!;
        if (siblings.has(literal)) duplicates.push(literal);
        siblings.add(literal);
      }

      i = j + 1;
      continue;
    }

    if (char === '{') stack.push(new Set());
    if (char === '}') stack.pop();
    i++;
  }

  return duplicates;
}

describe('message catalogues', () => {
  describe.each(LOCALES)('%s', (locale) => {
    it.each(NAMESPACES)('%s.json parses', (namespace) => {
      expect(() => JSON.parse(read(locale, namespace))).not.toThrow();
    });

    it.each(NAMESPACES)('%s.json has no duplicate keys', (namespace) => {
      expect(duplicateKeys(read(locale, namespace))).toEqual([]);
    });
  });

  it('detects a duplicate key when there is one', () => {
    // Guards the guard: a detector that never fires would pass every test above.
    expect(duplicateKeys('{ "a": 1, "a": 2 }')).toEqual(['a']);
    expect(duplicateKeys('{ "outer": { "a": 1 }, "other": { "a": 2 } }')).toEqual([]);
    expect(duplicateKeys('{ "a": "a colon : and a { brace", "b": 1 }')).toEqual([]);
  });
});
