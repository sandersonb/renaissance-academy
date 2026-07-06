/**
 * AuthService — register / confirm / login (RULES_SPEC §10; register.pl,
 * confirm.pl, login2.pl). Security deviations: bcrypt with crypt()-verify +
 * upgrade-on-login (S3); random expiring confirm token (S6); non-IP-pinned
 * sessions (S4).
 *
 * NOTE: the legacy lottery-question survey at confirmation (RULES_SPEC §9,
 * non-returning families) is handled by the Survey flow — wired in a later M2
 * pass. Here confirm marks the account CONFIRMED.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { Database } from '../ports/database.js';
import type { ParentRepo, SessionRecord, SessionRepo, UserRepo } from '../ports/repositories.js';
import type { Mailer } from '../ports/mailer.js';
import { PW_ALGO, realPasswordOps, type PasswordOps } from './password.js';

const token = () => randomUUID().replace(/-/g, '');

const US_STATES = new Set(
  'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY AS GU MP PR VI'.split(' '),
);

export const registerSchema = z.object({
  username: z.string().regex(/^\w{3,}$/, 'Username must be alphanumeric, 3+ chars, no spaces'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  relationship: z.string().default('PARENT'),
  address: z.string().default(''),
  city: z.string().default(''),
  state: z.string().refine((s) => US_STATES.has(s), 'Invalid state'),
  zip: z.coerce.number().int().nonnegative(),
  email: z.string().email('Invalid email address'),
  homePhone: z.string().regex(/^\(?\d{3}\)?\d{3}-?\d{4}$/, 'Invalid phone'),
  alternateEmail: z.string().email().optional(),
  returning: z.boolean().default(false),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export class AuthError extends Error {}

/** Lets confirm() gate on the lottery (Type B) survey for non-returning families. */
export interface ParentSurveyGate {
  hasPending(parentId: number): Promise<boolean>;
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (legacy cookie window)
const CONFIRM_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export class AuthService {
  private pw: PasswordOps;
  private users: UserRepo;
  private parents: ParentRepo;
  private sessions: SessionRepo;
  constructor(
    private db: Database,
    private config: AppConfig,
    pw?: PasswordOps,
    private surveyGate?: ParentSurveyGate,
    private mailer?: Mailer,
  ) {
    this.pw = pw ?? realPasswordOps(config.bcryptCost);
    this.users = db.repos.users;
    this.parents = db.repos.parents;
    this.sessions = db.repos.sessions;
  }

  /**
   * register.pl: create user (PENDING) + parent + enqueue the confirmation email,
   * all in ONE transaction (transactional outbox). If any step fails — including
   * the email enqueue — everything rolls back, so there are no orphaned accounts
   * and a retry works cleanly.
   */
  async register(raw: unknown): Promise<{ parentId: number; confirmToken: string }> {
    const input = registerSchema.parse(raw);
    if (await this.users.findByUsername(input.username)) {
      throw new AuthError(`The username '${input.username}' is already in use.`);
    }
    const existing = await this.parents.findByEmailAndName(input.email, input.firstName, input.lastName);
    if (existing) throw new AuthError('This user already exists in our database.');

    const pwHash = await this.pw.hashBcrypt(input.password);
    // Keep encpass populated (legacy crypt) so Perl can authenticate during the
    // rollback window; bcrypt is the primary going forward.
    const encpass = this.config.dualWriteLegacyCrypt ? this.pw.makeLegacyCrypt(input.password) : '';
    const confirmToken = token();

    const parentId = await this.db.transaction(async (tx) => {
      const id = await tx.users.create({ username: input.username, encpass, status: 'PENDING', pwHash, pwAlgo: PW_ALGO });
      await tx.parents.create({
        parentId: id,
        lastName: input.lastName,
        firstName: input.firstName,
        relationship: input.relationship,
        address: input.address,
        city: input.city,
        state: input.state,
        zip: input.zip,
        homePhone: input.homePhone,
        otherPhone: null,
        returning: input.returning,
        email: input.email,
        alternateEmail: input.alternateEmail ?? null,
        guid: null,
        confirmToken,
        confirmExpires: new Date(Date.now() + CONFIRM_TTL_MS),
        resetToken: null,
        resetExpires: null,
      });
      // Enqueue the confirmation email in the same transaction (rolls back with
      // the account if it fails). The worker delivers it after commit.
      await tx.outbox.enqueue(input.email, 'confirmation', {
        link: `${this.config.appBaseUrl}/confirm?token=${confirmToken}`,
      });
      return id;
    });

    return { parentId, confirmToken };
  }

  private async resolveToken(token: string) {
    const parent = await this.parents.findByConfirmToken(token);
    if (!parent) throw new AuthError('Invalid or unknown confirmation link.');
    if (parent.confirmExpires && parent.confirmExpires.getTime() < Date.now()) {
      throw new AuthError('This confirmation link has expired.');
    }
    return parent;
  }

  /**
   * confirm.pl: validate the token. Returning families confirm immediately;
   * non-returning families must first answer the lottery (Type B) survey — when
   * pending, returns confirmed:false and the route walks the questions, calling
   * markConfirmed() once the survey is complete (RULES_SPEC §9).
   */
  async confirm(token: string): Promise<{ confirmed: boolean; parentId: number }> {
    const parent = await this.resolveToken(token);
    let needsSurvey = false;
    if (!parent.returning && this.surveyGate) {
      needsSurvey = await this.surveyGate.hasPending(parent.parentId);
    }
    if (needsSurvey) return { confirmed: false, parentId: parent.parentId };
    await this.users.setStatus(parent.parentId, 'CONFIRMED');
    return { confirmed: true, parentId: parent.parentId };
  }

  async parentIdForToken(token: string): Promise<number> {
    return (await this.resolveToken(token)).parentId;
  }

  async markConfirmed(parentId: number): Promise<void> {
    await this.users.setStatus(parentId, 'CONFIRMED');
  }

  /** login2.pl: verify password (bcrypt, else legacy crypt + upgrade), issue session. */
  async login(username: string, password: string): Promise<SessionRecord> {
    const user = await this.users.findByUsername(username);
    if (!user) throw new AuthError('User does not exist.');

    let ok = false;
    if (user.pwHash) {
      ok = await this.pw.verifyBcrypt(password, user.pwHash);
    } else if (this.pw.verifyLegacyCrypt(password, user.encpass)) {
      ok = true;
      // Upgrade-on-login: store a bcrypt hash for next time.
      await this.users.setPasswordHash(user.id, await this.pw.hashBcrypt(password), PW_ALGO);
    }
    if (!ok) throw new AuthError('You entered the wrong password.');

    if (user.status !== 'CONFIRMED') {
      throw new AuthError('This username has not been validated. Please check your email.');
    }
    return this.sessions.create(user.id, SESSION_TTL_MS);
  }

  async logout(token: string): Promise<void> {
    await this.sessions.destroy(token);
  }

  async userIdForSession(sessionToken: string | undefined): Promise<number | null> {
    if (!sessionToken) return null;
    const s = await this.sessions.find(sessionToken);
    return s?.userId ?? null;
  }

  /**
   * forgotpass.pl (modernized): verify username + email match, then email a
   * reset LINK (legacy emailed a new plaintext password — replaced for security).
   * Always resolves the same way to avoid account enumeration; `devToken` is a
   * temporary convenience until real email lands (M4).
   */
  async requestPasswordReset(username: string, email: string): Promise<{ devToken?: string }> {
    const user = await this.users.findByUsername(username);
    if (!user) return {};
    const parent = await this.parents.findById(user.id);
    if (!parent || parent.email.toLowerCase() !== email.toLowerCase()) return {};
    const t = token();
    await this.parents.setResetToken(user.id, t, new Date(Date.now() + CONFIRM_TTL_MS));
    await this.mailer?.sendPasswordReset(parent.email, `${this.config.appBaseUrl}/reset?token=${t}`);
    return { devToken: t };
  }

  async resetPassword(resetToken: string, newPassword: string): Promise<void> {
    if (newPassword.length < 6) throw new AuthError('Password must be at least 6 characters.');
    const parent = await this.parents.findByResetToken(resetToken);
    if (!parent || !parent.resetExpires || parent.resetExpires.getTime() < Date.now()) {
      throw new AuthError('This reset link is invalid or has expired.');
    }
    await this.users.setPasswordHash(parent.parentId, await this.pw.hashBcrypt(newPassword), PW_ALGO);
    if (this.config.dualWriteLegacyCrypt) await this.users.setEncpass(parent.parentId, this.pw.makeLegacyCrypt(newPassword));
    await this.parents.setResetToken(parent.parentId, null, null);
  }

  /** resend.pl: re-issue the confirmation email for a PENDING account. */
  async resendConfirmation(email: string): Promise<{ devToken?: string }> {
    const parent = await this.parents.findByEmail(email);
    if (!parent) return {};
    const user = await this.users.findById(parent.parentId);
    if (!user || user.status !== 'PENDING') return {};
    const t = token();
    await this.parents.setConfirmToken(parent.parentId, t, new Date(Date.now() + CONFIRM_TTL_MS));
    await this.mailer?.sendConfirmation(parent.email, `${this.config.appBaseUrl}/confirm?token=${t}`);
    return { devToken: t };
  }
}
