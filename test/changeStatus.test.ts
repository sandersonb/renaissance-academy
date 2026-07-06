import { describe, it, expect } from 'vitest';
import { RegStatus } from '../src/domain/regStatus.js';
import type { Child } from '../src/domain/types.js';
import { changeStatus } from '../src/domain/changeStatus.js';

const child = (over: Partial<Child> & Pick<Child, 'childId' | 'grade' | 'regStatus'>): Child => ({
  parentId: 1,
  considerations: 0,
  position: null,
  ...over,
});

// Grade 0 cap = 3.
const CAPS = [3, 0, 0, 0, 0, 0, 0, 0, 0, 0] as const;

describe('changeStatus (Enrollment.pm parity)', () => {
  it('rejects an illegal transition', () => {
    const kids = [child({ childId: 1, grade: 0, regStatus: RegStatus.INITIAL })];
    const r = changeStatus(kids, 1, RegStatus.REGISTER, CAPS);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Unable to change/);
  });

  it('requires a position to change a wait-listed child', () => {
    const kids = [child({ childId: 1, grade: 0, regStatus: RegStatus.WAIT, position: null })];
    const r = changeStatus(kids, 1, RegStatus.PEND_OFFER, CAPS);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/missing Position/);
  });

  it('blocks an offer when the grade is full', () => {
    const kids = [
      child({ childId: 1, grade: 0, regStatus: RegStatus.REGISTER }),
      child({ childId: 2, grade: 0, regStatus: RegStatus.OFFER }),
      child({ childId: 3, grade: 0, regStatus: RegStatus.ACPT_REENROLL }), // 3 seats used
      child({ childId: 4, grade: 0, regStatus: RegStatus.WAIT, position: 1 }),
    ];
    const r = changeStatus(kids, 4, RegStatus.PEND_OFFER, CAPS);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Used 3 of 3/);
  });

  it('blocks a WAIT->offer when SIB_WAIT students are ahead', () => {
    const kids = [
      child({ childId: 1, grade: 0, regStatus: RegStatus.SIB_WAIT, position: 1 }),
      child({ childId: 2, grade: 0, regStatus: RegStatus.WAIT, position: 1 }),
    ];
    const r = changeStatus(kids, 2, RegStatus.PEND_OFFER, CAPS);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ahead in SIB_WAIT/);
  });

  it('offers a WAIT child and coalesces the queue behind them', () => {
    const kids = [
      child({ childId: 1, grade: 0, regStatus: RegStatus.WAIT, position: 1 }),
      child({ childId: 2, grade: 0, regStatus: RegStatus.WAIT, position: 2 }),
      child({ childId: 3, grade: 0, regStatus: RegStatus.WAIT, position: 3 }),
    ];
    const r = changeStatus(kids, 1, RegStatus.PEND_OFFER, CAPS);
    expect(r.ok).toBe(true);
    const offered = r.changes.find((c) => c.childId === 1);
    expect(offered?.to).toBe(RegStatus.PEND_OFFER);
    expect(offered?.position).toBeNull();
    // #2 and #3 move up to positions 1 and 2.
    expect(r.changes.find((c) => c.childId === 2)?.position).toBe(1);
    expect(r.changes.find((c) => c.childId === 3)?.position).toBe(2);
  });

  it('sets a paperwork expiration on OFFER->PEND_REGISTER', () => {
    const kids = [child({ childId: 1, grade: 0, regStatus: RegStatus.OFFER })];
    const r = changeStatus(kids, 1, RegStatus.PEND_REGISTER, CAPS);
    expect(r.ok).toBe(true);
    expect(r.changes[0]?.setExpiration).toBe('paperwork');
  });

  it('clears ChildExtra on DECLINE', () => {
    const kids = [child({ childId: 1, grade: 0, regStatus: RegStatus.OFFER })];
    const r = changeStatus(kids, 1, RegStatus.DECLINE, CAPS);
    expect(r.ok).toBe(true);
    expect(r.changes[0]?.clearChildExtra).toBe(true);
  });

  it('pulls a WAIT sibling forward when extending an offer', () => {
    // Caps: grade 0 = 3 (1 used), grade 1 = 2 (0 used).
    const caps = [3, 2, 0, 0, 0, 0, 0, 0, 0, 0] as const;
    const kids = [
      child({ childId: 1, parentId: 9, grade: 0, regStatus: RegStatus.WAIT, position: 1 }),
      child({ childId: 2, parentId: 9, grade: 1, regStatus: RegStatus.WAIT, position: 1 }),
    ];
    const r = changeStatus(kids, 1, RegStatus.PEND_OFFER, caps);
    expect(r.ok).toBe(true);
    // sibling #2 should be promoted to PEND_OFFER (room in grade 1, no SIB_WAIT ahead)
    expect(r.changes.find((c) => c.childId === 2)?.to).toBe(RegStatus.PEND_OFFER);
  });
});
