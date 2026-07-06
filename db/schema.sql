-- Renaissance Academy enrollment schema (no PII).
-- Derived from a post-purge production dump: table structure + non-PII
-- reference data only (Extra, ExtraTitles, MaxEnrollment, SiteSettings).
-- Additive app columns/tables come from db/migrations/*.sql.

-- MySQL dump 10.13  Distrib 5.6.50, for Linux (x86_64)
--
-- Host: localhost    Database: enrollment
-- ------------------------------------------------------
-- Server version	5.7.44-log

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `Child`
--

DROP TABLE IF EXISTS `Child`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `Child` (
  `Child_ID` mediumint(9) NOT NULL AUTO_INCREMENT,
  `Parent_ID` mediumint(9) NOT NULL,
  `Last_Name` varchar(30) COLLATE utf8_unicode_ci NOT NULL,
  `First_Name` varchar(30) COLLATE utf8_unicode_ci NOT NULL,
  `Middle_Name` varchar(30) COLLATE utf8_unicode_ci DEFAULT NULL,
  `Gender` char(1) COLLATE utf8_unicode_ci NOT NULL,
  `DOB` date NOT NULL,
  `Grade_nxt_yr` char(1) COLLATE utf8_unicode_ci NOT NULL,
  `Reg_Date` date NOT NULL,
  `Reg_Status` varchar(16) COLLATE utf8_unicode_ci NOT NULL DEFAULT 'INITIAL',
  `Language_Preference` varchar(8) COLLATE utf8_unicode_ci DEFAULT NULL,
  `Lottery_Considerations` int(11) DEFAULT '0',
  `UpdateTime` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `Position` int(6) DEFAULT NULL,
  `Expiration` date DEFAULT NULL,
  `parent_notes` varchar(4096) COLLATE utf8_unicode_ci NOT NULL,
  PRIMARY KEY (`Child_ID`),
  UNIQUE KEY `position` (`Position`,`Reg_Status`,`Grade_nxt_yr`)
) ENGINE=MyISAM AUTO_INCREMENT=1062 DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `Child`
--

LOCK TABLES `Child` WRITE;
/*!40000 ALTER TABLE `Child` DISABLE KEYS */;
/*!40000 ALTER TABLE `Child` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `ChildExtra`
--

DROP TABLE IF EXISTS `ChildExtra`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `ChildExtra` (
  `Child_ID` mediumint(9) NOT NULL DEFAULT '0',
  `Extra_ID` int(4) NOT NULL DEFAULT '0',
  PRIMARY KEY (`Child_ID`,`Extra_ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `ChildExtra`
--

LOCK TABLES `ChildExtra` WRITE;
/*!40000 ALTER TABLE `ChildExtra` DISABLE KEYS */;
/*!40000 ALTER TABLE `ChildExtra` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `Current_Student`
--

DROP TABLE IF EXISTS `Current_Student`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `Current_Student` (
  `Child_ID` mediumint(9) NOT NULL AUTO_INCREMENT,
  `Last_Name` varchar(30) CHARACTER SET utf8 COLLATE utf8_unicode_ci NOT NULL,
  `First_Name` varchar(30) CHARACTER SET utf8 COLLATE utf8_unicode_ci NOT NULL,
  `Middle_Name` varchar(30) CHARACTER SET utf8 COLLATE utf8_unicode_ci DEFAULT NULL,
  `Gender` char(1) CHARACTER SET utf8 COLLATE utf8_unicode_ci NOT NULL,
  `DOB` date NOT NULL,
  `Reg_Status` varchar(16) CHARACTER SET utf8 COLLATE utf8_unicode_ci NOT NULL DEFAULT 'PEND_REENROLL',
  `Grade` smallint(2) NOT NULL,
  PRIMARY KEY (`Child_ID`)
) ENGINE=InnoDB AUTO_INCREMENT=1024 DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `Current_Student`
--

LOCK TABLES `Current_Student` WRITE;
/*!40000 ALTER TABLE `Current_Student` DISABLE KEYS */;
/*!40000 ALTER TABLE `Current_Student` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `Declines`
--

DROP TABLE IF EXISTS `Declines`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `Declines` (
  `Parent_ID` mediumint(9) NOT NULL,
  `Reason` varchar(64) COLLATE utf8_unicode_ci NOT NULL,
  PRIMARY KEY (`Parent_ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `Declines`
--

LOCK TABLES `Declines` WRITE;
/*!40000 ALTER TABLE `Declines` DISABLE KEYS */;
/*!40000 ALTER TABLE `Declines` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `Extra`
--

DROP TABLE IF EXISTS `Extra`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `Extra` (
  `Extra_ID` int(4) NOT NULL AUTO_INCREMENT,
  `Title_ID` int(4) NOT NULL,
  `Value` varchar(31) COLLATE utf8_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`Extra_ID`),
  KEY `Value` (`Value`)
) ENGINE=InnoDB AUTO_INCREMENT=19 DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `Extra`
--

LOCK TABLES `Extra` WRITE;
/*!40000 ALTER TABLE `Extra` DISABLE KEYS */;
INSERT INTO `Extra` VALUES (1,6,'AM'),(2,6,'PM'),(3,7,'Yes'),(4,7,'No'),(5,7,'Don\'t Know'),(6,8,'Arabic'),(7,8,'Chinese'),(8,8,'Spanish'),(9,9,'Arabic'),(10,9,'Spanish'),(11,9,'Chinese (Dual Immersion)'),(12,10,'Arabic'),(13,10,'Spanish'),(14,36,'Full-Time On-Campus'),(15,36,'Full-Time Online'),(16,37,'Yes'),(17,37,'No'),(18,6,'Full-day');
/*!40000 ALTER TABLE `Extra` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `ExtraTitles`
--

DROP TABLE IF EXISTS `ExtraTitles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `ExtraTitles` (
  `Title_ID` mediumint(9) NOT NULL AUTO_INCREMENT,
  `Question` varchar(128) NOT NULL DEFAULT '',
  `Grade` varchar(22) DEFAULT NULL,
  `Lottery_question` int(11) NOT NULL DEFAULT '0' COMMENT 'If value is 0 this is a child registration question.  If it is 1 then it''s a lottery entrance question',
  `Brief` varchar(16) DEFAULT NULL,
  PRIMARY KEY (`Title_ID`)
) ENGINE=InnoDB AUTO_INCREMENT=38 DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `ExtraTitles`
--

LOCK TABLES `ExtraTitles` WRITE;
/*!40000 ALTER TABLE `ExtraTitles` DISABLE KEYS */;
INSERT INTO `ExtraTitles` VALUES (6,'Which Kindergarten session would you prefer? (does not guarantee placement in this session)','-0-',0,'K Session'),(8,'Which of the following languages would be your first preference for study? (does not guarantee placement in this language)','-6-7-8-9-',0,'Language'),(9,'Which of the following languages would be your first preference for study? (does not guarantee placement in this language)','-1-',0,'Language'),(10,'Which of the following languages would be your first preference for study? (does not guarantee placement in this language)','-2-3-4-5-',0,'Language'),(11,'Which of the following reasons influenced your decision to apply for Renaissance Academy?',NULL,1,'pushmarket'),(14,'In which of our existing extracurricular activities is your student(s) most interested?',NULL,1,'extracurricular'),(17,'How many times have you or your student(s) visited Renaissance Academy?',NULL,1,'visit_count'),(20,'How did you find out about us?',NULL,1,'referredby'),(23,'What families do you know who attend Renaissance Academy?',NULL,1,'support'),(26,'What other charter or private schools are you also considering?',NULL,1,'competition'),(29,'What will influence your final decision on where to enroll your student?',NULL,1,'criteria'),(32,'On which date will you make your final decision in which school to enroll your student?',NULL,1,'decision_expiry'),(35,'Please share any remaining questions you have about the school that we can answer.',NULL,1,'additional_info'),(37,'Is the student registering as a transfer student from a State-Accredited DLI program?','-2-3-4-5-6-7-8-9-',0,'chinese_transfer');
/*!40000 ALTER TABLE `ExtraTitles` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `MaxEnrollment`
--

DROP TABLE IF EXISTS `MaxEnrollment`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `MaxEnrollment` (
  `Grade` char(1) COLLATE utf8_unicode_ci NOT NULL,
  `Num_Students` int(3) NOT NULL,
  PRIMARY KEY (`Grade`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `MaxEnrollment`
--

LOCK TABLES `MaxEnrollment` WRITE;
/*!40000 ALTER TABLE `MaxEnrollment` DISABLE KEYS */;
INSERT INTO `MaxEnrollment` VALUES ('0',160),('1',120),('2',120),('3',120),('4',110),('5',100),('6',100),('7',80),('8',30),('9',50);
/*!40000 ALTER TABLE `MaxEnrollment` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `Note`
--

DROP TABLE IF EXISTS `Note`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `Note` (
  `ID` mediumint(9) NOT NULL AUTO_INCREMENT,
  `Parent_ID` mediumint(9) NOT NULL,
  `Date` datetime NOT NULL,
  `Note` blob NOT NULL,
  PRIMARY KEY (`ID`)
) ENGINE=InnoDB AUTO_INCREMENT=38 DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `Note`
--

LOCK TABLES `Note` WRITE;
/*!40000 ALTER TABLE `Note` DISABLE KEYS */;
/*!40000 ALTER TABLE `Note` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `Parent`
--

DROP TABLE IF EXISTS `Parent`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `Parent` (
  `Parent_ID` mediumint(9) NOT NULL AUTO_INCREMENT,
  `Last_Name` varchar(30) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `First_Name` varchar(30) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `Relationship` varchar(10) COLLATE utf8_unicode_ci NOT NULL DEFAULT 'PARENT',
  `Address` varchar(45) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `City` varchar(30) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `State` varchar(2) COLLATE utf8_unicode_ci NOT NULL DEFAULT 'UT',
  `Zip` mediumint(8) unsigned NOT NULL DEFAULT '0',
  `Home_Phone` varchar(14) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `Other_Phone` varchar(14) COLLATE utf8_unicode_ci DEFAULT '',
  `returning` tinyint(4) NOT NULL DEFAULT '0',
  `Reg_Date` date NOT NULL DEFAULT '1970-01-01',
  `Reg_State` varchar(16) COLLATE utf8_unicode_ci NOT NULL DEFAULT 'INITIAL',
  `Email` varchar(128) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `Alternate_Email` varchar(128) COLLATE utf8_unicode_ci DEFAULT NULL,
  `GUID` varchar(48) COLLATE utf8_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`Parent_ID`)
) ENGINE=InnoDB AUTO_INCREMENT=8985 DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `Parent`
--

LOCK TABLES `Parent` WRITE;
/*!40000 ALTER TABLE `Parent` DISABLE KEYS */;
/*!40000 ALTER TABLE `Parent` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `ParentExtra`
--

DROP TABLE IF EXISTS `ParentExtra`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `ParentExtra` (
  `Parent_ID` mediumint(9) NOT NULL DEFAULT '0',
  `Title_ID` mediumint(9) NOT NULL,
  `Answer` varchar(256) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `ParentExtra`
--

LOCK TABLES `ParentExtra` WRITE;
/*!40000 ALTER TABLE `ParentExtra` DISABLE KEYS */;
/*!40000 ALTER TABLE `ParentExtra` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Temporary table structure for view `Parent_Answers`
--

DROP TABLE IF EXISTS `Parent_Answers`;
/*!50001 DROP VIEW IF EXISTS `Parent_Answers`*/;
SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8;
/*!50001 CREATE VIEW `Parent_Answers` AS SELECT 
 1 AS `Question`,
 1 AS `Answer`,
 1 AS `Parent`*/;
SET character_set_client = @saved_cs_client;

--
-- Temporary table structure for view `Please_Answer`
--

DROP TABLE IF EXISTS `Please_Answer`;
/*!50001 DROP VIEW IF EXISTS `Please_Answer`*/;
SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8;
/*!50001 CREATE VIEW `Please_Answer` AS SELECT 
 1 AS `First_Name`,
 1 AS `Last_Name`,
 1 AS `Home_Phone`,
 1 AS `Other_Phone`,
 1 AS `Email`,
 1 AS `Answer`*/;
SET character_set_client = @saved_cs_client;

--
-- Table structure for table `SiteSettings`
--

DROP TABLE IF EXISTS `SiteSettings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `SiteSettings` (
  `lottery_year` int(11) NOT NULL,
  `post_lottery` tinyint(1) NOT NULL,
  `lottery_open` tinyint(1) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=latin1;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `SiteSettings`
--

LOCK TABLES `SiteSettings` WRITE;
/*!40000 ALTER TABLE `SiteSettings` DISABLE KEYS */;
INSERT INTO `SiteSettings` VALUES (2020,0,1);
/*!40000 ALTER TABLE `SiteSettings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `user_cookies`
--

DROP TABLE IF EXISTS `user_cookies`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `user_cookies` (
  `cookie_id` varchar(32) COLLATE utf8_unicode_ci NOT NULL,
  `user_id` int(11) NOT NULL,
  `login_time` datetime DEFAULT NULL,
  `ip_addr` varchar(16) COLLATE utf8_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `user_cookies_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `user_cookies`
--

LOCK TABLES `user_cookies` WRITE;
/*!40000 ALTER TABLE `user_cookies` DISABLE KEYS */;
/*!40000 ALTER TABLE `user_cookies` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(32) COLLATE utf8_unicode_ci NOT NULL,
  `encpass` varchar(256) COLLATE utf8_unicode_ci NOT NULL,
  `status` varchar(12) COLLATE utf8_unicode_ci NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=8985 DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Final view structure for view `Parent_Answers`
--

/*!50001 DROP VIEW IF EXISTS `Parent_Answers`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8 */;
/*!50001 SET character_set_results     = utf8 */;
/*!50001 SET collation_connection      = utf8_general_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/* definer removed */
/*!50001 VIEW `Parent_Answers` AS select 1 AS `Question`,1 AS `Answer`,1 AS `Parent` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `Please_Answer`
--

/*!50001 DROP VIEW IF EXISTS `Please_Answer`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8 */;
/*!50001 SET character_set_results     = utf8 */;
/*!50001 SET collation_connection      = utf8_general_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/* definer removed */
/*!50001 VIEW `Please_Answer` AS select 1 AS `First_Name`,1 AS `Last_Name`,1 AS `Home_Phone`,1 AS `Other_Phone`,1 AS `Email`,1 AS `Answer` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2025-02-28 18:47:35
