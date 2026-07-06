import { describe, it, expect } from 'vitest';
import { RegStatus } from '../src/domain/regStatus.js';
import { parseRoster, parseRosterDate } from '../src/domain/rosterCsv.js';
import { createMemoryDatabase } from '../src/app/adapters/memory/index.js';
import { RollYearService, RollYearError } from '../src/app/services/rollYearService.js';

const CSV = `Student Legal Last Name,Student Legal First Name,Student Legal Middle Name,Student Sex,Student Birth Date,Grade Level Next Year
Smith,John,,M,10/8/2011,9
Brown,Sally,Jordan,F,6/5/2012,9`;

describe('roster CSV parsing (bug fixes)', () => {
  it('parses M/D/YYYY dates (not the legacy 2-digit %y)', () => {
    expect(parseRosterDate('10/8/2011')).toBe('2011-10-08');
    expect(parseRosterDate('6/5/2012')).toBe('2012-06-05');
    expect(parseRosterDate('13/1/2011')).toBeNull(); // invalid month
  });

  it('skips the header row and parses students', () => {
    const { rows, errors } = parseRoster(CSV);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2); // header NOT imported as a student
    expect(rows[0]).toMatchObject({ lastName: 'Smith', firstName: 'John', dob: '2011-10-08', grade: 9 });
    expect(rows[1]!.middleName).toBe('Jordan');
  });

  it('flags out-of-range returning grades and bad dates', () => {
    const bad = `h,e,a,d,e,r\nDoe,Jane,,F,2/2/2015,0\nRoe,Jim,,M,notadate,3`;
    const { rows, errors } = parseRoster(bad);
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(2); // grade 0 (not 1-9) + bad date
  });
});

describe('RollYearService', () => {
  function seedSomeData() {
    const db = createMemoryDatabase();
    db.store.children.set(1, { childId: 1, parentId: 1, lastName: 'Old', firstName: 'Kid', middleName: null, gender: 'M', dob: '2018-01-01', gradeNextYear: 3, regStatus: RegStatus.ACPT_REENROLL, languagePreference: null, lotteryConsiderations: 0, position: null, expiration: null, parentNotes: '' });
    db.store.parents.set(1, { parentId: 1, lastName: 'Old', firstName: 'P', relationship: 'PARENT', address: '', city: '', state: 'UT', zip: 0, homePhone: '', otherPhone: null, returning: true, email: 'old@x.com', alternateEmail: null, guid: null, confirmToken: null, confirmExpires: null, resetToken: null, resetExpires: null });
    return db;
  }

  it('validate() reports counts/errors without changing anything', () => {
    const repos = seedSomeData();
    const v = new RollYearService(repos).validate(CSV);
    expect(v.ok).toBe(true);
    expect(v.rowCount).toBe(2);
    expect(repos.store.children.size).toBe(1); // unchanged
  });

  it('commit() purges, imports the roster, and sets the new year', async () => {
    const repos = seedSomeData();
    const svc = new RollYearService(repos);
    const r = await svc.commit(2027, CSV);
    expect(r.imported).toBe(2);
    expect(repos.store.children.size).toBe(0);          // last year's children purged
    expect(repos.store.currentStudents.size).toBe(2);   // roster imported
    expect([...repos.store.currentStudents.values()][0]!.regStatus).toBe(RegStatus.PEND_REENROLL);
    expect(await repos.repos.settings.get()).toMatchObject({ yearBegin: 2027, lotteryOpen: true, postLottery: false });
  });

  it('refuses to purge when the roster has errors', async () => {
    const repos = seedSomeData();
    await expect(new RollYearService(repos).commit(2027, 'header\nBad,Row,,M,notadate,3')).rejects.toBeInstanceOf(RollYearError);
    expect(repos.store.children.size).toBe(1); // nothing was purged
  });
});
