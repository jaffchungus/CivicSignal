-- CivicSignal: clear all reports and report history
--
-- Keeps: users, sessions, organizations, categories, municipalities,
-- settings (other than the report counter), push subscriptions, and
-- audit entries that are not tied to reports.
--
-- Works with the application's SQLite and PostgreSQL schemas.
--
-- IMPORTANT:
-- 1. Back up the application database before running this.
-- 2. This removes database rows only. Local files in uploads/, external
--    Vercel Blob objects, and files in Supabase storage are not removed by SQL.
-- 3. The audit_events delete below is limited to report history. To clear
--    every audit entry, including account and organization history, uncomment
--    the final optional delete before COMMIT.

BEGIN;

-- Report-related notifications must be removed before their reports.
DELETE FROM notifications
WHERE report_id IS NOT NULL;

-- Report-scoped audit records.
DELETE FROM audit_events
WHERE target_type = 'REPORT';

-- Report history and attachments.
DELETE FROM report_events;
DELETE FROM report_updates;
DELETE FROM attachments;
DELETE FROM guest_report_access;

-- The reports themselves.
DELETE FROM reports;

-- Photos stored inside the database. This also removes orphaned photo blobs
-- left by failed submissions.
DELETE FROM report_photos;

-- Start numbering again at CS-<current year>-0001. If this row does not
-- exist, CivicSignal reseeds it from the now-empty reports table.
UPDATE settings
SET value = '0'
WHERE key = 'report_reference_counter';

-- Optional: remove every audit entry, including non-report account history.
-- DELETE FROM audit_events;

COMMIT;
