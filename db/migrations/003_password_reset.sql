-- Additive: token-based password reset (modernizes the legacy forgotpass.pl,
-- which emailed a new plaintext password). Safe for the Perl app (ignored).
ALTER TABLE `Parent`
  ADD COLUMN `reset_token` VARCHAR(64) NULL,
  ADD COLUMN `reset_expires` DATETIME NULL;
