-- Additive: per-year settings that replace the hand-edited page.pm globals
-- ($year_begin, $lottery_open, $post_lottery) — deviation B6. Single-row table.
CREATE TABLE IF NOT EXISTS `app_settings` (
  `id`           TINYINT NOT NULL DEFAULT 1,
  `year_begin`   INT NOT NULL,
  `lottery_open` TINYINT(1) NOT NULL DEFAULT 1,
  `post_lottery` TINYINT(1) NOT NULL DEFAULT 0,
  `updated_at`   DATETIME NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

INSERT INTO `app_settings` (`id`, `year_begin`, `lottery_open`, `post_lottery`, `updated_at`)
  VALUES (1, YEAR(CURDATE()), 1, 0, NOW());
