/**
 * Pure enrollment validation rules (users.pm: build_dob, validate_gender,
 * validate_grade, validate_considerations). Kept framework-free and testable.
 */
import { Consideration } from './regStatus.js';

export type DobResult = { ok: true; dob: string } | { ok: false; reason: 'invalid' | 'too_young_for_k' };

/**
 * build_dob: validate a date of birth for the enrollment year and return
 * YYYY-MM-DD. A child must turn 5 before ~Sept 1 of the enrollment year:
 * born in/after September of (yearBegin - 5) is too young for Kindergarten.
 */
export function buildDob(year: number, month: number, day: number, yearBegin: number): DobResult {
  if (year >= yearBegin - 5 && month >= 9) return { ok: false, reason: 'too_young_for_k' };
  if (
    year >= yearBegin - 16 &&
    year <= yearBegin - 5 &&
    month >= 1 && month <= 12 &&
    day >= 1 && day <= 31
  ) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return { ok: true, dob: `${year}-${pad(month)}-${pad(day)}` };
  }
  return { ok: false, reason: 'invalid' };
}

export const isValidGender = (g: string): boolean => g === 'M' || g === 'F' || g === 'O';

export const isValidGrade = (g: number): boolean => Number.isInteger(g) && g >= 0 && g <= 9;

/** Returning grade must be 1..9 — K is the entry grade (no returning K),
 *  current 9th graders graduate out (RULES_SPEC §5, deviation B9). */
export const isValidReturningGrade = (g: number): boolean => Number.isInteger(g) && g >= 1 && g <= 9;

export function considerationsBitmask(o: {
  current?: boolean;
  sibling?: boolean;
  preference?: boolean;
}): number {
  return (
    (o.current ? Consideration.CURRENT : 0) +
    (o.sibling ? Consideration.SIBLING : 0) +
    (o.preference ? Consideration.PREFERENCE : 0)
  );
}
