-- FRESH enrollment_preview ONLY, via db:init-preview; never import into production.
-- Reviewed legacy-compatible structure and public reference fixtures from schema.sql.
-- Intermediate utf8mb3 is intentional for unchanged migrations 001-008. The
-- bootstrap is incomplete until utf8mb4.sql finishes and metadata is verified.
-- No families, accounts, legacy cycle row, dummy views, drops or table locks.

CREATE TABLE users (
  id MEDIUMINT NOT NULL AUTO_INCREMENT,
  username VARCHAR(32) COLLATE utf8_unicode_ci NOT NULL,
  encpass VARCHAR(256) COLLATE utf8_unicode_ci NOT NULL,
  status VARCHAR(12) COLLATE utf8_unicode_ci NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE Parent (
  Parent_ID MEDIUMINT NOT NULL,
  Last_Name VARCHAR(30) NOT NULL DEFAULT '', First_Name VARCHAR(30) NOT NULL DEFAULT '',
  Relationship VARCHAR(10) NOT NULL DEFAULT 'PARENT', Address VARCHAR(45) NOT NULL DEFAULT '',
  City VARCHAR(30) NOT NULL DEFAULT '', State VARCHAR(2) NOT NULL DEFAULT 'UT',
  Zip MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
  Home_Phone VARCHAR(14) NOT NULL DEFAULT '', Other_Phone VARCHAR(14) DEFAULT '',
  returning TINYINT DEFAULT 0, Reg_Date DATE NOT NULL DEFAULT '1970-01-01',
  Reg_State VARCHAR(16) NOT NULL DEFAULT 'INITIAL', Email VARCHAR(128) NOT NULL DEFAULT '',
  Alternate_Email VARCHAR(128) DEFAULT NULL, GUID VARCHAR(48) DEFAULT NULL,
  PRIMARY KEY (Parent_ID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE Child (
  Child_ID MEDIUMINT NOT NULL AUTO_INCREMENT, Parent_ID MEDIUMINT NOT NULL,
  Last_Name VARCHAR(30) NOT NULL, First_Name VARCHAR(30) NOT NULL,
  Middle_Name VARCHAR(30) DEFAULT NULL, Gender CHAR(1) NOT NULL, DOB DATE NOT NULL,
  Grade_nxt_yr CHAR(1) NOT NULL, Reg_Date DATE NOT NULL,
  Reg_Status VARCHAR(16) NOT NULL DEFAULT 'INITIAL', Language_Preference VARCHAR(8) DEFAULT NULL,
  Lottery_Considerations INT DEFAULT 0, UpdateTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  Position INT DEFAULT NULL, Expiration DATE DEFAULT NULL, parent_notes VARCHAR(4096) NOT NULL,
  PRIMARY KEY (Child_ID), UNIQUE KEY `position` (Position,Reg_Status,Grade_nxt_yr)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE ChildExtra (
  Child_ID MEDIUMINT NOT NULL DEFAULT 0, Extra_ID INT NOT NULL DEFAULT 0,
  PRIMARY KEY (Child_ID,Extra_ID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE Current_Student (
  Child_ID MEDIUMINT NOT NULL AUTO_INCREMENT,
  Last_Name VARCHAR(30) NOT NULL, First_Name VARCHAR(30) NOT NULL,
  Middle_Name VARCHAR(30) DEFAULT NULL, Gender CHAR(1) NOT NULL, DOB DATE NOT NULL,
  Reg_Status VARCHAR(16) NOT NULL DEFAULT 'PEND_REENROLL', Grade SMALLINT NOT NULL,
  PRIMARY KEY (Child_ID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE Declines (
  Parent_ID MEDIUMINT NOT NULL, Reason VARCHAR(64) NOT NULL, PRIMARY KEY (Parent_ID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE Extra (
  Extra_ID INT NOT NULL AUTO_INCREMENT, Title_ID INT NOT NULL,
  Value VARCHAR(31) DEFAULT NULL, PRIMARY KEY (Extra_ID), KEY `Value` (Value)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE ExtraTitles (
  Title_ID MEDIUMINT NOT NULL AUTO_INCREMENT, Question VARCHAR(128) NOT NULL DEFAULT '',
  Grade VARCHAR(22) DEFAULT NULL, Lottery_question INT NOT NULL DEFAULT 0,
  Brief VARCHAR(16) DEFAULT NULL, PRIMARY KEY (Title_ID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE MaxEnrollment (
  Grade CHAR(1) NOT NULL, Num_Students INT NOT NULL, PRIMARY KEY (Grade)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE Note (
  ID MEDIUMINT NOT NULL AUTO_INCREMENT, Parent_ID MEDIUMINT NOT NULL,
  Date DATETIME NOT NULL, Note BLOB NOT NULL, PRIMARY KEY (ID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE ParentExtra (
  Parent_ID MEDIUMINT NOT NULL DEFAULT 0, Title_ID MEDIUMINT NOT NULL, Answer VARCHAR(256) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE SiteSettings (
  lottery_year INT NOT NULL, post_lottery TINYINT NOT NULL, lottery_open TINYINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE user_cookies (
  cookie_id VARCHAR(32) NOT NULL, user_id MEDIUMINT NOT NULL,
  login_time DATETIME DEFAULT NULL, ip_addr VARCHAR(16) DEFAULT NULL,
  PRIMARY KEY (user_id),
  CONSTRAINT user_cookies_ibfk_1 FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

INSERT INTO Extra (Extra_ID,Title_ID,Value) VALUES
  (1,6,'AM'),(2,6,'PM'),(3,7,'Yes'),(4,7,'No'),(5,7,'Don''t Know'),
  (6,8,'Arabic'),(7,8,'Chinese'),(8,8,'Spanish'),(9,9,'Arabic'),(10,9,'Spanish'),
  (11,9,'Chinese (Dual Immersion)'),(12,10,'Arabic'),(13,10,'Spanish'),
  (14,36,'Full-Time On-Campus'),(15,36,'Full-Time Online'),(16,37,'Yes'),(17,37,'No'),(18,6,'Full-day');

INSERT INTO ExtraTitles (Title_ID,Question,Grade,Lottery_question,Brief) VALUES
  (6,'Which Kindergarten session would you prefer? (does not guarantee placement in this session)','-0-',0,'K Session'),
  (8,'Which of the following languages would be your first preference for study? (does not guarantee placement in this language)','-6-7-8-9-',0,'Language'),
  (9,'Which of the following languages would be your first preference for study? (does not guarantee placement in this language)','-1-',0,'Language'),
  (10,'Which of the following languages would be your first preference for study? (does not guarantee placement in this language)','-2-3-4-5-',0,'Language'),
  (11,'Which of the following reasons influenced your decision to apply for Renaissance Academy?',NULL,1,'pushmarket'),
  (14,'In which of our existing extracurricular activities is your student(s) most interested?',NULL,1,'extracurricular'),
  (17,'How many times have you or your student(s) visited Renaissance Academy?',NULL,1,'visit_count'),
  (20,'How did you find out about us?',NULL,1,'referredby'),
  (23,'What families do you know who attend Renaissance Academy?',NULL,1,'support'),
  (26,'What other charter or private schools are you also considering?',NULL,1,'competition'),
  (29,'What will influence your final decision on where to enroll your student?',NULL,1,'criteria'),
  (32,'On which date will you make your final decision in which school to enroll your student?',NULL,1,'decision_expiry'),
  (35,'Please share any remaining questions you have about the school that we can answer.',NULL,1,'additional_info'),
  (37,'Is the student registering as a transfer student from a State-Accredited DLI program?','-2-3-4-5-6-7-8-9-',0,'chinese_transfer');

INSERT INTO MaxEnrollment (Grade,Num_Students) VALUES
  ('0',160),('1',120),('2',120),('3',120),('4',110),('5',100),('6',100),('7',80),('8',30),('9',50);
