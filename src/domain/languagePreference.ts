/**
 * Language-preference encoding for re-enrolling grades 1 & 6
 * (reenrollChild.pl `build_language_pref`). First/second choice values:
 *   first:  Arabic=400, Chinese=200, Spanish=100
 *   second: Arabic=40,  Chinese=20,  Spanish=10
 * The sum maps to an ordered 3-language code. First and second must differ.
 */
export const LANG_FIRST = { Arabic: 400, Chinese: 200, Spanish: 100 } as const;
export const LANG_SECOND = { Arabic: 40, Chinese: 20, Spanish: 10 } as const;

const CODES: Record<number, string> = {
  420: 'AR-CH-SP',
  410: 'AR-SP-CH',
  240: 'CH-AR-SP',
  210: 'CH-SP-AR',
  140: 'SP-AR-CH',
  120: 'SP-CH-AR',
};

export type LangResult =
  | { ok: true; code: string }
  | { ok: false; reason: 'same_choice' | 'invalid' };

export function buildLanguagePreference(first: number, second: number): LangResult {
  if (first === second * 10) return { ok: false, reason: 'same_choice' };
  const code = CODES[first + second];
  return code ? { ok: true, code } : { ok: false, reason: 'invalid' };
}
