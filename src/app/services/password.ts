/**
 * Password hashing (IMPLEMENTATION_PLAN S3). The legacy app stores Unix
 * `crypt()` (DES) hashes in `users.encpass`. We verify those on login and
 * transparently upgrade to bcrypt in `users.pw_hash`; during the rollback
 * window we can also re-write a fresh `crypt()` so the Perl app still works.
 */
import bcrypt from 'bcryptjs';
import unixCrypt from 'unix-crypt-td-js';

export const PW_ALGO = 'bcrypt';

export async function hashBcrypt(plain: string, cost: number): Promise<string> {
  return bcrypt.hash(plain, cost);
}

export async function verifyBcrypt(plain: string, hash: string): Promise<boolean> {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}

/** Compute a legacy DES crypt() hash (salt = first 2 chars of `saltSource`). */
export function legacyCrypt(plain: string, saltSource: string): string {
  return unixCrypt(plain, saltSource);
}

/** Verify a plaintext password against a stored legacy `crypt()` hash. */
export function verifyLegacyCrypt(plain: string, encpass: string): boolean {
  if (!encpass) return false;
  try {
    return legacyCrypt(plain, encpass) === encpass;
  } catch {
    return false;
  }
}

/** Generate a fresh legacy crypt() hash with a random 2-char salt (dual-write). */
export function makeLegacyCrypt(plain: string): string {
  const chars = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const salt = chars[Math.floor(Math.random() * 64)]! + chars[Math.floor(Math.random() * 64)]!;
  return legacyCrypt(plain, salt);
}

/** Pluggable verifier set so services can be unit-tested without the crypt lib. */
export interface PasswordOps {
  hashBcrypt(plain: string): Promise<string>;
  verifyBcrypt(plain: string, hash: string): Promise<boolean>;
  verifyLegacyCrypt(plain: string, encpass: string): boolean;
  makeLegacyCrypt(plain: string): string;
}

export function realPasswordOps(bcryptCost: number): PasswordOps {
  return {
    hashBcrypt: (p) => hashBcrypt(p, bcryptCost),
    verifyBcrypt,
    verifyLegacyCrypt,
    makeLegacyCrypt,
  };
}
