-- 0007: returning work to students, re-check requests, grade boundaries, teacher profiles.

-- ---------------------------------------------------------------- tests
-- Students see nothing until the teacher releases results. Grade boundaries are optional:
-- [{"label":"A","min":80},{"label":"B","min":65},...] (percent thresholds, any order).
alter table public.tests add column results_released boolean not null default false;
alter table public.tests add column released_at timestamptz;
alter table public.tests add column grade_boundaries jsonb;
grant select (results_released, released_at, grade_boundaries) on public.tests to anon, authenticated;   -- see 0002

-- ---------------------------------------------------------------- submissions: a private link per script
-- The student's results page (/r/<token>) is opened by the server with this token; it shows only approved marks,
-- and only after the teacher released the test.
alter table public.submissions add column result_token text not null default encode(gen_random_bytes(16), 'hex');
create unique index submissions_result_token_key on public.submissions (result_token);

-- ---------------------------------------------------------------- re-check requests from students
create table public.review_requests (
  id             uuid primary key default gen_random_uuid(),
  submission_id  uuid not null references public.submissions(id) on delete cascade,
  q              int not null,
  message        text not null check (char_length(message) between 3 and 1000),
  status         text not null default 'open' check (status in ('open', 'resolved')),
  response       text check (char_length(response) <= 1000),
  created_at     timestamptz not null default now(),
  resolved_at    timestamptz
);
create index on public.review_requests (submission_id, status);
alter table public.review_requests enable row level security;
-- teachers read and answer requests on their own scripts; students create them through the server (token checked)
create policy requests_owner_read on public.review_requests for select to authenticated
  using (public.owns_class(public.class_of_submission(submission_id)));
create policy requests_owner_update on public.review_requests for update to authenticated
  using (public.owns_class(public.class_of_submission(submission_id)))
  with check (public.owns_class(public.class_of_submission(submission_id)));
revoke insert, delete on public.review_requests from anon, authenticated;
revoke update on public.review_requests from anon, authenticated;
grant update (status, response, resolved_at) on public.review_requests to authenticated;

-- ---------------------------------------------------------------- teacher profile (name and school on reports)
create table public.teacher_profiles (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  display_name  text check (char_length(display_name) <= 80),
  school        text check (char_length(school) <= 120),
  updated_at    timestamptz not null default now()
);
alter table public.teacher_profiles enable row level security;
create policy profiles_owner_all on public.teacher_profiles for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
