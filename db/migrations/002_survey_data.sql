-- Widen storage for the identical legacy-visible choices in the checksummed
-- 002_survey_data.json companion. The runner validates that mapping before any
-- migration writes, then backfills only new metadata/missing reviewed choices
-- in a DML transaction. It never replaces questions, options or answers.
ALTER TABLE `Extra` MODIFY `Value` VARCHAR(255) COLLATE utf8_unicode_ci DEFAULT NULL;
