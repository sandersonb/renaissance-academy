/**
 * Populate a dev/demo database with realistic sample data. Uses the real repos
 * + password hashing so logins work and statuses/bitmasks are valid.
 *
 *   DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASSWORD=secret DB_NAME=enrollment \
 *     npm run db:seed -- --mode=pre-lottery
 *
 * Modes (default: post-lottery):
 *   --mode=pre-lottery   Applicants awaiting the draw. Only pre-lottery statuses
 *                        (INITIAL new applicants + re-enrollment states). The
 *                        smallest-cap grades are deliberately oversubscribed, so
 *                        running the lottery WILL offer some and waitlist a random
 *                        set of the rest.
 *   --mode=post-lottery  The system as it looks AFTER a draw: offers, acceptance-
 *                        in-progress, paperwork, registered, and ordered wait /
 *                        sibling-wait lists — a spread across every status.
 *   --only=current-students   Refresh just the Current_Student roster.
 *
 * Re-runnable: it PURGES the per-year tables (parents/children/notes/etc.) first,
 * then seeds fresh. Admins and reference data (survey questions, MaxEnrollment)
 * are preserved. NEVER run against production.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../config.js';
import { createMysqlDatabase, createPool } from '../adapters/mysql';
import type { Database } from '../ports/database.js';
import { parseRoster } from '../../domain/rosterCsv.js';
import { Consideration, RegStatus } from '../../domain/regStatus.js';
import { hashBcrypt, makeLegacyCrypt } from '../services/password.js';
import { AdminAuthService } from '../services/adminAuthService.js';
import { SurveyService } from '../services/surveyService.js';
import { addDays, today } from '../util/dates.js';

const ROSTER_CSV = () => join(process.cwd(), 'db', 'sample-roster.csv');
type Mode = 'pre-lottery' | 'post-lottery';

/** Read `--flag <value>` / `--flag=<value>` from argv. */
function argValue(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const i = args.indexOf(`--${flag}`);
  if (i >= 0) return args[i + 1];
  return args.find((a) => a.startsWith(`--${flag}=`))?.split('=')[1];
}

const FIRST = ['Ava', 'Ben', 'Cora', 'Dev', 'Ela', 'Finn', 'Gia', 'Hugo', 'Iris', 'Jack', 'Kira', 'Leo',
  'Mia', 'Noah', 'Ola', 'Pia', 'Quinn', 'Rex', 'Sia', 'Theo', 'Uma', 'Vin', 'Willa', 'Xan', 'Yara', 'Zed'];
const LAST = ['Nguyen', 'Patel', 'Garcia', 'Smith', 'Kim', 'Johnson', 'Lee', 'Martinez', 'Brown', 'Davis',
  'Lopez', 'Wilson', 'Clark', 'Young', 'Hall', 'Green', 'Baker', 'Adams', 'Reed', 'Cook'];

const PARENT_PASSWORD = 'parentpass';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'admin12345';

async function main() {
  if (!process.env.DB_HOST) throw new Error('DB_HOST not set — seeding requires a real database.');
  const config = loadConfig();
  const pool = createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER ?? 'root',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'enrollment',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
  });
  const db: Database = createMysqlDatabase(pool);

  // --only current-students refreshes just the Current_Student roster.
  const only = argValue('only');
  if (only === 'current-students') {
    const { rows } = parseRoster(readFileSync(ROSTER_CSV(), 'utf8'));
    await pool.query('TRUNCATE TABLE `Current_Student`');
    await db.repos.maintenance.importCurrentStudents(rows);
    console.log(`imported ${rows.length} current students (status PEND_REENROLL)`);
    await pool.end();
    return;
  }
  if (only) throw new Error(`unknown --only mode '${only}' (supported: current-students)`);

  const mode = (argValue('mode') ?? 'post-lottery') as Mode;
  if (mode !== 'pre-lottery' && mode !== 'post-lottery') {
    throw new Error(`unknown --mode '${mode}' (supported: pre-lottery, post-lottery)`);
  }

  console.log(`seeding in '${mode}' mode — purging per-year tables (parents/children/notes/…) …`);
  await db.repos.maintenance.purgeForNewYear();

  // Admin (preserved across purges; create if missing).
  const adminAuth = new AdminAuthService(db.repos.admins, db.repos.adminSessions, config);
  if (!(await db.repos.admins.findByUsername('admin'))) {
    await adminAuth.createAdmin('admin', ADMIN_PASSWORD);
    console.log(`created admin 'admin' / '${ADMIN_PASSWORD}'`);
  }

  // Pre-lottery: draw not yet run. Post-lottery: draw complete.
  await db.repos.settings.set({ yearBegin: config.yearBegin, lotteryOpen: true, postLottery: mode === 'post-lottery' });

  // Current-student roster (for the re-enrollment flow) from the sample CSV.
  const { rows: roster } = parseRoster(readFileSync(ROSTER_CSV(), 'utf8'));
  await db.repos.maintenance.importCurrentStudents(roster);

  // Shared parent password hash (one bcrypt op, reused).
  const pwHash = await hashBcrypt(PARENT_PASSWORD, config.bcryptCost);
  const encpass = config.dualWriteLegacyCrypt ? makeLegacyCrypt(PARENT_PASSWORD) : '';
  const survey = new SurveyService(db.repos.children, db.repos.survey);

  let fam = 0;
  const createdParents: number[] = [];
  /** Create a fresh parent (unique username/email) and return its id + surname. */
  const newParent = async (returning = false): Promise<{ id: number; last: string }> => {
    fam += 1;
    const last = LAST[fam % LAST.length]!;
    const first = FIRST[(fam * 3) % FIRST.length]!;
    const id = await db.repos.users.create({ username: `fam${fam}`, encpass, status: 'CONFIRMED', pwHash, pwAlgo: 'bcrypt' });
    await db.repos.parents.create({
      parentId: id, lastName: last, firstName: first, relationship: 'Parent', address: `${100 + fam} Main St`,
      city: 'Lehi', state: 'UT', zip: 84043, homePhone: '(801)555-0100', otherPhone: null, returning,
      email: `fam${fam}@example.com`, alternateEmail: null, guid: null,
      confirmToken: null, confirmExpires: null, resetToken: null, resetExpires: null,
    });
    createdParents.push(id);
    return { id, last };
  };

  const addChild = async (
    parentId: number, first: string, last: string, grade: number, status: RegStatus,
    opts: { position?: number; considerations?: number } = {},
  ): Promise<number> => {
    const expiration = status === RegStatus.OFFER ? addDays(today(), config.offerExpirationDays)
      : status === RegStatus.PEND_REGISTER ? addDays(today(), config.paperworkExpirationDays) : null;
    return db.repos.children.create({
      parentId, lastName: last, firstName: first, middleName: null, gender: 'F', dob: '2020-05-01',
      gradeNextYear: grade, regStatus: status, languagePreference: null,
      lotteryConsiderations: opts.considerations ?? 0, position: opts.position ?? null, expiration, parentNotes: '',
    });
  };

  const answerLottery = async (parentId: number) => {
    for (let n = 0; n < 20; n++) {
      const q = await survey.nextLotteryQuestion(parentId);
      if (!q) break;
      await survey.answerLottery(parentId, q.titleId, [q.options[0]?.value ?? 'Sample response']);
    }
  };
  const answerRegistration = async (childId: number) => {
    for (let n = 0; n < 20; n++) {
      const q = await survey.nextRegistrationQuestion(childId);
      if (!q || !q.options[0]) break;
      await survey.answerRegistration(childId, [q.options[0].extraId]);
    }
  };

  const counts: Record<string, number> = {};
  const tally = (s: RegStatus, n = 1) => { counts[s] = (counts[s] ?? 0) + n; };

  if (mode === 'pre-lottery') {
    await seedPreLottery();
  } else {
    await seedPostLottery();
  }

  const outbox = await db.repos.outbox.countByState();
  const spread = Object.entries(counts).map(([s, n]) => `${s}:${n}`).join(' ');
  console.log(`seeded (${mode}): ${fam} families / ${Object.values(counts).reduce((a, b) => a + b, 0)} students · ${spread}`
    + (outbox.pending ? ` · ${outbox.pending} queued emails` : ''));
  console.log(`admin: admin / ${ADMIN_PASSWORD}   ·   parents: fam1..fam${fam} / ${PARENT_PASSWORD}`);
  await pool.end();
  return;

  // ---- mode generators (closures over the helpers above) ----

  /**
   * Applicants awaiting the draw. Only INITIAL (+ a few re-enrollment states).
   * The smallest-cap grades are oversubscribed so the lottery must waitlist a
   * random subset; ~1 in 4 applicants there flags a sibling → some SIB_WAIT.
   */
  async function seedPreLottery(): Promise<void> {
    const caps = await db.repos.capacity.gradeCaps();
    // Oversubscribe the two smallest-cap grades; light, under-cap pools elsewhere.
    const bySize = caps.map((c, g) => ({ g, c })).sort((a, b) => a.c - b.c);
    const oversubscribed = new Set(bySize.slice(0, 2).map((x) => x.g));

    const surveyed: number[] = [];
    for (let g = 0; g <= 9; g++) {
      const cap = caps[g] ?? 0;
      const count = oversubscribed.has(g) ? cap + Math.max(8, Math.round(cap * 0.35)) : 5;
      for (let i = 0; i < count; i++) {
        const { id, last } = await newParent();
        const sibling = i % 4 === 0 ? Consideration.SIBLING : 0;
        await addChild(id, FIRST[(g * 7 + i) % FIRST.length]!, last, g, RegStatus.INITIAL, { considerations: sibling });
        tally(RegStatus.INITIAL);
        if (surveyed.length < 15) surveyed.push(id); // keep survey inserts bounded
      }
    }

    // A few returning students mid-cycle, for re-enrollment status variety.
    const reenroll: [RegStatus, number][] = [
      [RegStatus.ACPT_REENROLL, 4], [RegStatus.IP_REENROLL, 2], [RegStatus.PEND_REENROLL, 2], [RegStatus.DECL_REENROLL, 1],
    ];
    let rg = 0;
    for (const [status, n] of reenroll) {
      for (let i = 0; i < n; i++) {
        rg = (rg % 9) + 1; // spread returning students across grades 1..9
        const { id, last } = await newParent(true);
        await addChild(id, FIRST[(rg * 5 + i) % FIRST.length]!, last, rg, status);
        tally(status);
      }
    }

    for (const pid of surveyed) await answerLottery(pid);
  }

  /**
   * Post-draw system: a spread across every status, with correctly ordered
   * wait / sibling-wait lists (SIB_WAIT ahead of WAIT), offers with deadlines,
   * paperwork in progress, and fully-registered students.
   */
  async function seedPostLottery(): Promise<void> {
    // Returning (accepted re-enrollment) students consuming seats across grades.
    for (let g = 0; g <= 8; g += 2) {
      for (let i = 0; i < 3; i++) {
        const { id, last } = await newParent(true);
        await addChild(id, FIRST[(g + i) % FIRST.length]!, last, g, RegStatus.ACPT_REENROLL);
        tally(RegStatus.ACPT_REENROLL);
      }
    }

    const registered: number[] = [];
    // A full post-lottery cohort in a few representative grades.
    for (const g of [0, 4, 8]) {
      const singles: [RegStatus, number][] = [
        [RegStatus.REGISTER, 3], [RegStatus.OFFER, 2], [RegStatus.PEND_OFFER, 1], [RegStatus.IP_OFFER, 1],
        [RegStatus.PEND_REGISTER, 2], [RegStatus.FIN_REGISTER, 1], [RegStatus.DECLINE, 1],
      ];
      for (const [status, n] of singles) {
        for (let i = 0; i < n; i++) {
          const { id, last } = await newParent();
          const cid = await addChild(id, FIRST[(g * 3 + i) % FIRST.length]!, last, g, status);
          tally(status);
          if (status === RegStatus.REGISTER || status === RegStatus.PEND_REGISTER || status === RegStatus.FIN_REGISTER) {
            registered.push(cid);
          }
          if (status === RegStatus.OFFER || status === RegStatus.PEND_REGISTER) await answerLottery(id);
        }
      }
      // Ordered wait lists: sibling-waits first (pos 1..2), then regular (pos 1..4).
      for (let p = 1; p <= 2; p++) {
        const { id, last } = await newParent();
        await addChild(id, FIRST[(g + p) % FIRST.length]!, last, g, RegStatus.SIB_WAIT, { position: p, considerations: Consideration.SIBLING });
        tally(RegStatus.SIB_WAIT);
      }
      for (let p = 1; p <= 4; p++) {
        const { id, last } = await newParent();
        await addChild(id, FIRST[(g + p + 5) % FIRST.length]!, last, g, RegStatus.WAIT, { position: p });
        tally(RegStatus.WAIT);
      }
    }

    // Registration (Type A) answers for students who have accepted; lottery
    // (Type B) answers were added for offered/paperwork parents above.
    for (const cid of registered) await answerRegistration(cid);

    if (createdParents[0]) await db.repos.notes.add(createdParents[0], 'Called parent re: accepting offer.');
    if (createdParents[1]) await db.repos.notes.add(createdParents[1], 'Paperwork reminder sent.');
  }
}

main().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
});
