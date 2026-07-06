/**
 * Admin authentication — fully isolated from parent auth (separate `admin_users`
 * table + `admin_sessions`). Admins are created via CLI (npm run admin:create)
 * or an optional first-boot env bootstrap; further admins are managed in-app.
 */
import type { AppConfig } from '../config.js';
import type { AdminRepo, SessionRecord, SessionRepo } from '../ports/repositories.js';
import { PW_ALGO, hashBcrypt, verifyBcrypt } from './password.js';

export class AdminAuthError extends Error {}

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h for admin sessions

export class AdminAuthService {
  constructor(
    private admins: AdminRepo,
    private sessions: SessionRepo,
    private config: AppConfig,
  ) {}

  async createAdmin(username: string, password: string): Promise<number> {
    if (!/^\w{3,}$/.test(username)) throw new AdminAuthError('Username must be alphanumeric, 3+ chars.');
    if (password.length < 8) throw new AdminAuthError('Admin password must be at least 8 characters.');
    if (await this.admins.findByUsername(username)) throw new AdminAuthError(`Admin '${username}' already exists.`);
    return this.admins.create(username, await hashBcrypt(password, this.config.bcryptCost), PW_ALGO);
  }

  /** First-boot convenience: create the initial admin from env if none exist. */
  async bootstrapIfEmpty(username: string | undefined, password: string | undefined): Promise<boolean> {
    if (!username || !password) return false;
    if ((await this.admins.countActive()) > 0) return false;
    await this.createAdmin(username, password);
    return true;
  }

  async login(username: string, password: string): Promise<SessionRecord> {
    const admin = await this.admins.findByUsername(username);
    if (!admin || !admin.active || !(await verifyBcrypt(password, admin.pwHash))) {
      throw new AdminAuthError('Invalid admin credentials.');
    }
    return this.sessions.create(admin.id, SESSION_TTL_MS);
  }

  async logout(token: string): Promise<void> {
    await this.sessions.destroy(token);
  }

  async adminIdForSession(token: string | undefined): Promise<number | null> {
    if (!token) return null;
    return (await this.sessions.find(token))?.userId ?? null;
  }
}
