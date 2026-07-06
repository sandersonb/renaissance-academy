-- Additive: admin accounts + sessions in DEDICATED tables (the legacy /admin used
-- hardcoded passwords + any-IP access). Kept separate from `users`/`Parent` so the
-- annual December reset (which TRUNCATEs users/Parent) never wipes admins.
CREATE TABLE IF NOT EXISTS `admin_users` (
  `id`         INT NOT NULL AUTO_INCREMENT,
  `username`   VARCHAR(64) NOT NULL,
  `pw_hash`    VARCHAR(255) NOT NULL,
  `pw_algo`    VARCHAR(16) NOT NULL DEFAULT 'bcrypt',
  `active`     TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL,
  `last_login` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_admin_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE IF NOT EXISTS `admin_sessions` (
  `token`      VARCHAR(64) NOT NULL,
  `user_id`    INT NOT NULL,
  `issued_at`  DATETIME NOT NULL,
  `expires_at` DATETIME NOT NULL,
  PRIMARY KEY (`token`),
  KEY `idx_admin_session_user` (`user_id`),
  KEY `idx_admin_session_exp` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;
