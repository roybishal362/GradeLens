-- Fix found by scripts/rls-check.mjs: a column-level REVOKE has no effect while a role still holds table-level SELECT
-- (Supabase grants SELECT on all tables to anon + authenticated). So anyone could read the sample test's upload_token,
-- and any signed-in teacher could read it on the sample test too.
-- Fix: no table-level SELECT on tests for API roles; grant SELECT only on safe columns. The upload link is handed out
-- by the server (secret key) to the class owner only.
-- NOTE: any column added to public.tests later must be added to this grant list explicitly.
revoke select on public.tests from anon, authenticated;
grant select (id, class_id, title, rubric, rubric_status, uploads_open, created_at) on public.tests to anon, authenticated;
