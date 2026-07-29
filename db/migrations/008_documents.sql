-- Additive: admin-uploaded registration paperwork (replaces the public S3 PDFs
-- in the legacy enroll.pl). Stored in the DB so it backs up with everything else
-- and is served ONLY to authorized parents (a PEND_REGISTER child, or a
-- returning family) through the API — never a public link. One row per slot
-- (family / returning_family / grade_0..grade_9), replaced yearly by upload.
CREATE TABLE IF NOT EXISTS `enrollment_document` (
  `slug`         VARCHAR(32) NOT NULL,
  `filename`     VARCHAR(255) NOT NULL,
  `content_type` VARCHAR(100) NOT NULL DEFAULT 'application/pdf',
  `bytes`        LONGBLOB NOT NULL,
  `size`         INT NOT NULL,
  `uploaded_at`  DATETIME NOT NULL,
  `uploaded_by`  INT NULL,
  PRIMARY KEY (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;
