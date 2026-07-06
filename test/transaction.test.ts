import { describe, it, expect } from 'vitest';
import { RegStatus } from '../src/domain/regStatus.js';
import { createMemoryDatabase } from '../src/app/adapters/memory/index.js';

describe('Database.transaction (atomicity)', () => {
  it('commits all writes when the work succeeds', async () => {
    const db = createMemoryDatabase();
    await db.transaction(async (tx) => {
      await tx.notes.add(1, 'a');
      await tx.notes.add(1, 'b');
    });
    expect(await db.repos.notes.listByParent(1)).toHaveLength(2);
  });

  it('rolls back all writes when the work throws', async () => {
    const db = createMemoryDatabase();
    db.store.children.set(1, {
      childId: 1, parentId: 1, lastName: 'X', firstName: 'Y', middleName: null, gender: 'M', dob: '2020-01-01',
      gradeNextYear: 0, regStatus: RegStatus.WAIT, languagePreference: null, lotteryConsiderations: 0,
      position: 1, expiration: null, parentNotes: '',
    });
    await expect(
      db.transaction(async (tx) => {
        await tx.children.updateStatus(1, RegStatus.PEND_OFFER, null);
        await tx.notes.add(1, 'should be rolled back');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    // Nothing from the failed transaction persisted.
    expect((await db.repos.children.findById(1))?.regStatus).toBe(RegStatus.WAIT);
    expect((await db.repos.children.findById(1))?.position).toBe(1);
    expect(await db.repos.notes.listByParent(1)).toHaveLength(0);
  });
});
