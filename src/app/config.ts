/**
 * App configuration. These values currently live in env/constants; several of
 * them replace the legacy hand-edited `page.pm` globals and will become rows in
 * an `app_settings` table (IMPLEMENTATION_PLAN deviation B6).
 */
export interface AppConfig {
  /** Enrollment year (legacy `page.pm $year_begin`). school year = year..year+1. */
  yearBegin: number;
  /** Lottery open for new entries (legacy `$lottery_open`). */
  lotteryOpen: boolean;
  /** Lottery already run (legacy `$post_lottery`). */
  postLottery: boolean;
  offerExpirationDays: number; // expiration.pm $offer_expiration_days
  paperworkExpirationDays: number; // expiration.pm $paperwork_expiration_days
  bcryptCost: number;
  /** During the side-by-side rollback window, also write legacy crypt() so the
   *  Perl app can still authenticate users who change their password. */
  dualWriteLegacyCrypt: boolean;
  /** Base URL for links in emails (confirm / reset). */
  appBaseUrl: string;
  /** Child fields a PARENT may edit on an INITIAL student (legacy: none —
   *  ChildPermissions all 0). Admin-configurable; default locked. */
  childEditableFields: string[];
  /** App-level admin IP allowlist (defense-in-depth; nginx is the primary gate).
   *  Empty = allow all (dev). Entries match exactly or as an IP prefix. */
  adminIpAllowlist: string[];
  /** Trust X-Forwarded-* so request.ip is the real client behind nginx. */
  trustProxy: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const num = (v: string | undefined, d: number) => (v ? Number(v) : d);
  const bool = (v: string | undefined, d: boolean) => (v == null ? d : v === 'true' || v === '1');
  return {
    yearBegin: num(env.YEAR_BEGIN, new Date().getFullYear()),
    lotteryOpen: bool(env.LOTTERY_OPEN, true),
    postLottery: bool(env.POST_LOTTERY, false),
    offerExpirationDays: num(env.OFFER_EXPIRATION_DAYS, 3),
    paperworkExpirationDays: num(env.PAPERWORK_EXPIRATION_DAYS, 5),
    bcryptCost: num(env.BCRYPT_COST, 12),
    dualWriteLegacyCrypt: bool(env.DUAL_WRITE_LEGACY_CRYPT, true),
    appBaseUrl: env.APP_BASE_URL ?? 'http://localhost:5173',
    childEditableFields: (env.CHILD_EDITABLE_FIELDS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    adminIpAllowlist: (env.ADMIN_IP_ALLOWLIST ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    trustProxy: bool(env.TRUST_PROXY, false),
  };
}
