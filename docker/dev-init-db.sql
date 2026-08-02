-- Runs once, on first initialisation of the dev Postgres volume.
--
-- The main "ostastay" database is created by the POSTGRES_DB environment variable; this
-- adds the separate database the test suite wipes and rebuilds on every run
-- (vitest.global-setup.ts). Keeping them apart means `npm test` can never destroy the
-- data a developer is working with.
CREATE DATABASE ostastay_test;
