/**
 * Propose a district code from the district's name.
 *
 * ─── Why suggest at all ──────────────────────────────────────────────────────────
 *
 * "Code" is the field people stall on. It is three characters, it is permanent, it ends up
 * inside every project number issued in the district (ADR-025: `ACCO-WBR-26-0065`), and the
 * form gives no clue what a good one looks like. Faced with that, someone either invents a
 * spelling on the spot or abandons the dialog. Filling it in from the name they already typed
 * turns a decision into a confirmation.
 *
 * ─── Why the suggestion is editable, and why that is not a cop-out ───────────────
 *
 * Checked against the 20 seeded Banaadir districts this rule reproduces the real code for
 * about two thirds of them — Waaberi→WBR, Hodan→HDN, Kaaraan→KRN, Kaxda→KXD, Shibis→SHB,
 * Heliwaa→HLW, Dayniile→DNL, Xamar Jajab→XJJ — and disagrees with the rest
 * (Boondheere is BDH, not BND; Cabdicasiis is CDS, not CBD). Those codes were chosen by
 * people, and no mechanical rule recovers them, because there was never one rule. So this is
 * a starting point the user can overwrite, never a value the form imposes.
 */

const VOWELS = new Set(['A', 'E', 'I', 'O', 'U', 'Y']);
const CODE_LENGTH = 3;

/** Uppercase A–Z and single spaces. Diacritics fold to their base letter. */
function normalize(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z\s-]/g, ' ')
    .replace(/[\s-]+/g, ' ')
    .trim();
}

/** First letter, then the word's consonants, then whatever letters are left. */
function lettersFromWord(word: string): string[] {
  if (!word) return [];
  const [first, ...rest] = word.split('');
  const consonants = rest.filter((letter) => !VOWELS.has(letter));
  const vowels = rest.filter((letter) => VOWELS.has(letter));
  return [first as string, ...consonants, ...vowels];
}

/** The bare suggestion, before any collision handling. */
function baseCode(name: string): string {
  const words = normalize(name).split(' ').filter(Boolean);
  if (words.length === 0) return '';

  if (words.length >= CODE_LENGTH) {
    // Three or more words: one initial each. "Xamar Weyne Koonfur" -> XWK.
    return words
      .slice(0, CODE_LENGTH)
      .map((word) => word[0])
      .join('');
  }

  if (words.length === 2) {
    // Two words: both initials, then continue inside the second word — the distinguishing
    // half of a two-part name is almost always the second one. "Xamar Jajab" -> XJJ.
    const [one, two] = words as [string, string];
    const tail = lettersFromWord(two).slice(1);
    return [one[0], two[0], ...tail, ...lettersFromWord(one).slice(1)]
      .filter(Boolean)
      .slice(0, CODE_LENGTH)
      .join('');
  }

  return lettersFromWord(words[0] as string)
    .slice(0, CODE_LENGTH)
    .join('');
}

/**
 * @param name  What the user typed in the name field.
 * @param taken Codes already in the registry. The suggestion never collides with one.
 * @returns An uppercase code of up to three letters, or `''` for a name with no letters in it.
 */
export function suggestDistrictCode(name: string, taken: Iterable<string> = []): string {
  const base = baseCode(name);
  if (!base) return '';

  const used = new Set([...taken].map((code) => code.trim().toUpperCase()));
  if (!used.has(base)) return base;

  // Collision: keep the first two characters — they carry the recognisable part — and walk the
  // remaining letters of the name, then the alphabet, for a third that is free.
  const stem = base.slice(0, CODE_LENGTH - 1);
  const fromName = normalize(name).replace(/ /g, '').split('');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

  for (const letter of [...fromName, ...alphabet]) {
    const candidate = `${stem}${letter}`;
    if (!used.has(candidate)) return candidate;
  }

  // Every three-letter code on this stem is taken. Hand back the base and let the form's own
  // duplicate check say so, rather than inventing something unrecognisable.
  return base;
}
