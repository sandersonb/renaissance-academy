-- Forward-only session lifecycle hardening. Existing accounts/data/legacy cookies remain.
-- Apply with the API stopped after review; partial DDL failures use normal recovery.
ALTER TABLE `users` ADD COLUMN `session_version` INT UNSIGNED NOT NULL DEFAULT 0;
ALTER TABLE `admin_users` ADD COLUMN `session_version` INT UNSIGNED NOT NULL DEFAULT 0;
ALTER TABLE `app_sessions` ADD COLUMN `session_version` INT UNSIGNED NOT NULL DEFAULT 0;
ALTER TABLE `admin_sessions` ADD COLUMN `session_version` INT UNSIGNED NOT NULL DEFAULT 0;

-- Force clean reauthentication once; never reset versions or delete legacy user_cookies.
DELETE FROM `app_sessions`;
DELETE FROM `admin_sessions`;
