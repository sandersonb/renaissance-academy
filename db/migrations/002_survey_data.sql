-- B8 data migration: set input types on the existing questions and move the
-- Type B (lottery) option lists that were HARDCODED in confirm.pl Perl subs into
-- the `Extra` table, so surveys are fully data-driven. Run once
-- (the INSERTs assume Extra rows for these titles do not already exist).
--
-- Title IDs / text come from the production ExtraTitles + the confirm.pl subs.

-- The legacy `Extra.Value` is varchar(31) — too small for the long Type B
-- option strings, which is why they were hardcoded in Perl. Widen it (a safe,
-- non-breaking change: existing values fit, Perl reads it identically).
ALTER TABLE `Extra` MODIFY `Value` VARCHAR(255) COLLATE utf8_unicode_ci DEFAULT NULL;

-- Registration questions (lottery_question = 0): all single-select (radios).
UPDATE `ExtraTitles` SET `input_type` = 'single_select'
  WHERE `Title_ID` IN (6, 8, 9, 10, 37);

-- Lottery questions (lottery_question = 1): map each legacy widget to a type.
UPDATE `ExtraTitles` SET `input_type` = 'multi_select' WHERE `Title_ID` IN (11, 14); -- pushmarket, extracurricular
UPDATE `ExtraTitles` SET `input_type` = 'single_select' WHERE `Title_ID` = 17;        -- visit_count
UPDATE `ExtraTitles` SET `input_type` = 'text'          WHERE `Title_ID` = 20;        -- referredby
UPDATE `ExtraTitles` SET `input_type` = 'textarea'      WHERE `Title_ID` IN (23, 26, 29, 35); -- support, competition, criteria, additional_info
UPDATE `ExtraTitles` SET `input_type` = 'date'          WHERE `Title_ID` = 32;        -- decision_expiry

-- A sensible default display order (matches legacy do_next walk order).
UPDATE `ExtraTitles` SET `sort_order` = 10 WHERE `Title_ID` = 11;
UPDATE `ExtraTitles` SET `sort_order` = 20 WHERE `Title_ID` = 14;
UPDATE `ExtraTitles` SET `sort_order` = 30 WHERE `Title_ID` = 17;
UPDATE `ExtraTitles` SET `sort_order` = 40 WHERE `Title_ID` = 20;
UPDATE `ExtraTitles` SET `sort_order` = 50 WHERE `Title_ID` = 23;
UPDATE `ExtraTitles` SET `sort_order` = 60 WHERE `Title_ID` = 26;
UPDATE `ExtraTitles` SET `sort_order` = 70 WHERE `Title_ID` = 29;
UPDATE `ExtraTitles` SET `sort_order` = 80 WHERE `Title_ID` = 32;
UPDATE `ExtraTitles` SET `sort_order` = 90 WHERE `Title_ID` = 35;

-- Move hardcoded option lists into Extra. (Type 0 questions already have rows.)
-- pushmarket (Title_ID 11):
INSERT INTO `Extra` (`Title_ID`, `Value`) VALUES
  (11, 'Excellence of our world language program'),
  (11, 'Exciting after-school programs (dance, robotics, athletics, drama)'),
  (11, 'Small class sizes'),
  (11, 'Excellent faculty / academic reputation'),
  (11, 'Proximity to your home'),
  (11, 'Recommendation from family / friends');
-- extracurricular (Title_ID 14):
INSERT INTO `Extra` (`Title_ID`, `Value`) VALUES
  (14, 'Basketball (grades 6-9)'), (14, 'Soccer (grades 6-9)'),
  (14, 'Robotics (grades 5-9)'), (14, 'Drama (grades 3-9)'),
  (14, 'Beginning dance (grades 1-5)'), (14, 'Drill team / modern dance (grades 6-9)'),
  (14, 'Ballroom dance (grades 4-5)'), (14, 'Ballroom competition team (grades 6-9)'),
  (14, 'Art club (grades 3-9)'), (14, 'Coding club (grades 5-9)');
-- visit_count (Title_ID 17):
INSERT INTO `Extra` (`Title_ID`, `Value`) VALUES
  (17, '0'), (17, '1'), (17, '2 - 3'), (17, '4 - 6'), (17, '7+');
