import { loadConfig } from '../src/app/config.js';
import type { Database } from '../src/app/ports/database.js';
import { AuthService } from '../src/app/services/authService.js';
import type { PasswordOps } from '../src/app/services/password.js';

export const sessionConfig = loadConfig({ YEAR_BEGIN: '2027', BCRYPT_COST: '4', APP_BASE_URL: 'https://preview.invalid', DUAL_WRITE_LEGACY_CRYPT: 'true' });
export const fakeSessionPasswords: PasswordOps = {
  hashBcrypt: async (password) => `bcrypt:${password}`,
  verifyBcrypt: async (password, hash) => hash === `bcrypt:${password}`,
  verifyLegacyCrypt: (password, hash) => hash === `crypt:${password}`,
  makeLegacyCrypt: (password) => `crypt:${password}`,
};
export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
export async function sessionParent(db: Database, pw = fakeSessionPasswords, options: { legacy?: boolean; username?: string } = {}) {
  const username = options.username ?? 'syntheticparent';
  const password = 'old-pass123';
  const id = await db.repos.users.create({ username, status: 'CONFIRMED', encpass: pw.makeLegacyCrypt(password),
    pwHash: options.legacy ? null : await pw.hashBcrypt(password), pwAlgo: options.legacy ? null : 'bcrypt' });
  const email = `${username}@example.test`;
  await db.repos.parents.create({ parentId: id, firstName: 'Synthetic', lastName: 'Fixture', relationship: 'Parent',
    address: '', city: '', state: 'UT', zip: 0, homePhone: '', otherPhone: null, returning: false,
    email, alternateEmail: null, guid: null, confirmToken: null, confirmExpires: null, resetToken: null, resetExpires: null });
  const auth = new AuthService(db, sessionConfig, pw);
  return { id, username, password, email, auth };
}
