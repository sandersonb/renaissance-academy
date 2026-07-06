-- Additive: transactional email outbox (deviation B4). State changes enqueue a
-- row in the same operation; a worker drains it and sends. Decouples "the offer
-- was extended" from "the email was sent" so a send failure can't lose state,
-- and replaces the legacy cron+RAND()+LIMIT throttle + interleaved SMTP send.
CREATE TABLE IF NOT EXISTS `email_outbox` (
  `id`         INT NOT NULL AUTO_INCREMENT,
  `recipient`  VARCHAR(190) NOT NULL,
  `template`   VARCHAR(32) NOT NULL,
  `payload`    TEXT NOT NULL,                 -- JSON
  `state`      VARCHAR(16) NOT NULL DEFAULT 'pending',  -- pending | sent | failed
  `attempts`   INT NOT NULL DEFAULT 0,
  `last_error` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL,
  `sent_at`    DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_outbox_state` (`state`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;
