import { describe, it, expect } from 'vitest';
import { RegStatus } from '../src/domain/regStatus.js';
import { FLOW, flowable, canTransition } from '../src/domain/transitions.js';

describe('transition matrix ($flow parity)', () => {
  it('matches the canonical RULES_SPEC §4 matrix', () => {
    expect(FLOW[RegStatus.PEND_REENROLL]).toEqual([RegStatus.ACPT_REENROLL, RegStatus.DECL_REENROLL]);
    expect(FLOW[RegStatus.OFFER]).toEqual([RegStatus.PEND_REGISTER, RegStatus.DECLINE]);
    expect(FLOW[RegStatus.PEND_REGISTER]).toEqual([RegStatus.REGISTER, RegStatus.FIN_REGISTER, RegStatus.DECLINE]);
    expect(FLOW[RegStatus.REGISTER]).toEqual([RegStatus.DECLINE]);
  });

  it('allows legal transitions', () => {
    expect(canTransition(RegStatus.WAIT, RegStatus.PEND_OFFER)).toBe(true);
    expect(canTransition(RegStatus.SIB_WAIT, RegStatus.DECLINE)).toBe(true);
    expect(canTransition(RegStatus.FIN_REGISTER, RegStatus.REGISTER)).toBe(true);
  });

  it('rejects illegal transitions', () => {
    expect(canTransition(RegStatus.INITIAL, RegStatus.REGISTER)).toBe(false);
    expect(canTransition(RegStatus.REGISTER, RegStatus.OFFER)).toBe(false);
    expect(canTransition(RegStatus.DECLINE, RegStatus.OFFER)).toBe(false);
    expect(flowable(RegStatus.IP_OFFER)).toEqual([]);
  });
});
