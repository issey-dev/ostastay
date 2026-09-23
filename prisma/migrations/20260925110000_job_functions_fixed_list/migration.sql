-- Job functions are a fixed list in code since 2026-09-25 (src/lib/job-functions.ts), picked
-- on the People form; the enterprise-editable JOB_FUNCTION dropdown list is retired. Users
-- keep their stored post (User.jobFunction) — only the list rows go.
DELETE FROM "SystemCode" WHERE "category" = 'JOB_FUNCTION';
