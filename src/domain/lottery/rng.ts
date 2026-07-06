/**
 * Deterministic, seedable PRNG for the lottery (RULES_SPEC §6, deviation B3).
 *
 * Legacy used Perl's unseeded rand() with no recorded seed — not auditable or
 * reproducible. Here we generate a high-entropy seed (record it with the draw),
 * then derive a deterministic stream from it so a draw can be REPLAYED exactly
 * for verification. xmur3 (seed hashing) + mulberry32 (stream) — small, fast,
 * well-distributed; adequate for a fair draw with a recorded seed.
 */

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rng {
  /** float in [0, 1) */
  next(): number;
  /** integer in [0, n) */
  int(n: number): number;
  /** uniform pick */
  pick<T>(arr: readonly T[]): T;
  /** Fisher–Yates shuffle into a new array */
  shuffle<T>(arr: readonly T[]): T[];
}

export function createRng(seed: string): Rng {
  const seedFn = xmur3(seed);
  const next = mulberry32(seedFn());
  const int = (n: number) => Math.floor(next() * n);
  return {
    next,
    int,
    pick: (arr) => arr[int(arr.length)]!,
    shuffle: (arr) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = int(i + 1);
        [a[i], a[j]] = [a[j]!, a[i]!];
      }
      return a;
    },
  };
}

/** Generate a recordable, high-entropy seed for a real draw. */
export function makeSeed(): string {
  // Avoid a hard crypto import for portability; combine time + randomness.
  const rnd = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  return `${Date.now().toString(16)}-${rnd()}-${rnd()}`;
}
