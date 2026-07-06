-- Additive-only migration for the React/TypeScript app (IMPLEMENTATION_PLAN §3).
-- Adds columns/tables the new app needs WITHOUT altering or dropping anything
-- the legacy Perl app reads, so Perl keeps working as a rollback target.
--
-- MySQL 5.7 has no "ADD COLUMN IF NOT EXISTS" — run this exactly once.

-- S3: modern password hash alongside the legacy users.encpass (crypt()).
ALTER TABLE `users`
  ADD COLUMN `pw_hash` VARCHAR(255) NULL,
  ADD COLUMN `pw_algo` VARCHAR(16) NULL;

-- S6: random, expiring email-confirmation token alongside the legacy GUID.
ALTER TABLE `Parent`
  ADD COLUMN `confirm_token` VARCHAR(64) NULL,
  ADD COLUMN `confirm_expires` DATETIME NULL;

-- B8: fully data-driven surveys — render type, soft-delete, ordering.
ALTER TABLE `ExtraTitles`
  ADD COLUMN `input_type` VARCHAR(16) NOT NULL DEFAULT 'text',
  ADD COLUMN `active` TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN `sort_order` INT NOT NULL DEFAULT 0;

-- S4: server sessions (not IP-pinned). Legacy user_cookies is left untouched.
CREATE TABLE IF NOT EXISTS `app_sessions` (
  `token`      VARCHAR(64) NOT NULL,
  `user_id`    INT NOT NULL,
  `issued_at`  DATETIME NOT NULL,
  `expires_at` DATETIME NOT NULL,
  PRIMARY KEY (`token`),
  KEY `idx_user` (`user_id`),
  KEY `idx_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;
