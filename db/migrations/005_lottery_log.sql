-- Additive: immutable lottery draw log (deviation B3 — the legacy draw kept no
-- recorded seed or audit beyond free-text Notes). Each committed run records its
-- seed + caps so the exact allocation can be re-verified/replayed.
CREATE TABLE IF NOT EXISTS `lottery_run` (
  `id`        INT NOT NULL AUTO_INCREMENT,
  `seed`      VARCHAR(80) NOT NULL,
  `year`      INT NOT NULL,
  `caps`      VARCHAR(255) NOT NULL,         -- JSON array of per-grade caps
  `ran_at`    DATETIME NOT NULL,
  `committed` TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE IF NOT EXISTS `lottery_assignment` (
  `id`          INT NOT NULL AUTO_INCREMENT,
  `run_id`      INT NOT NULL,
  `child_id`    INT NOT NULL,
  `from_status` VARCHAR(16) NOT NULL,
  `to_status`   VARCHAR(16) NOT NULL,
  `position`    INT NULL,
  `phase`       VARCHAR(16) NOT NULL,
  `via_sibling` TINYINT(1) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_assignment_run` (`run_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;
