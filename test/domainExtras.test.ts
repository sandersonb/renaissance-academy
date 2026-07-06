import { describe, it, expect } from 'vitest';
import { RegStatus } from '../src/domain/regStatus.js';
import { gradeInScope } from '../src/domain/surveyScope.js';
import { buildLanguagePreference, LANG_FIRST, LANG_SECOND } from '../src/domain/languagePreference.js';
import { declineChild } from '../src/domain/declineChild.js';
import type { Child } from '../src/domain/types.js';

describe('gradeInScope', () => {
  it('matches grade-scoped and all-grades questions', () => {
    expect(gradeInScope('-6-7-8-9-', 7)).toBe(true);
    expect(gradeInScope('-6-7-8-9-', 1)).toBe(false);
    expect(gradeInScope('-0-', 0)).toBe(true);
    expect(gradeInScope(null, 3)).toBe(true);
  });
});

describe('buildLanguagePreference', () => {
  it('encodes ordered choices', () => {
    expect(buildLanguagePreference(LANG_FIRST.Arabic, LANG_SECOND.Chinese)).toEqual({ ok: true, code: 'AR-CH-SP' });
    expect(buildLanguagePreference(LANG_FIRST.Spanish, LANG_SECOND.Arabic)).toEqual({ ok: true, code: 'SP-AR-CH' });
  });
  it('rejects identical first/second choices', () => {
    expect(buildLanguagePreference(LANG_FIRST.Spanish, LANG_SECOND.Spanish)).toEqual({ ok: false, reason: 'same_choice' });
  });
});

describe('declineChild (cleanup_and_coalesce)', () => {
  const kids: Child[] = [
    { childId: 1, parentId: 1, grade: 0, regStatus: RegStatus.WAIT, considerations: 0, position: 2 },
    { childId: 2, parentId: 2, grade: 0, regStatus: RegStatus.WAIT, considerations: 0, position: 3 },
    { childId: 3, parentId: 3, grade: 0, regStatus: RegStatus.WAIT, considerations: 0, position: 4 },
  ];
  it('declines a waitlisted child and coalesces those behind', () => {
    const r = declineChild(kids, 1);
    expect(r.ok).toBe(true);
    expect(r.to).toBe(RegStatus.DECLINE);
    expect(r.coalesced).toEqual([{ childId: 2, position: 2 }, { childId: 3, position: 3 }]);
    expect(r.clearChildExtra).toBe(true);
  });
  it('uses DECL_REENROLL for a returning student', () => {
    const r = declineChild([{ childId: 9, parentId: 1, grade: 3, regStatus: RegStatus.ACPT_REENROLL, considerations: 0, position: null }], 9);
    expect(r.to).toBe(RegStatus.DECL_REENROLL);
  });
});
