-- GradeLens schema v1.
-- Security model: every table has Row Level Security ON. Teachers (Supabase Auth users) can only touch rows of
-- classes they own. Student uploads and AI jobs run on the server with the secret key, after the server has checked an
-- unguessable per-test upload token. The built-in sample class is readable by anyone (demo mode for judges).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tables
create table public.classes (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 120),
  subject     text check (char_length(subject) <= 80),
  is_sample   boolean not null default false,
  created_at  timestamptz not null default now()
);

create table public.tests (
  id            uuid primary key default gen_random_uuid(),
  class_id      uuid not null references public.classes(id) on delete cascade,
  title         text not null check (char_length(title) between 1 and 160),
  rubric        jsonb not null default '{"questions":[]}'::jsonb,   -- see src/lib/grading/schemas.ts RubricSchema
  rubric_status text not null default 'draft' check (rubric_status in ('draft', 'approved')),
  upload_token  text not null unique default encode(gen_random_bytes(18), 'base64'),
  uploads_open  boolean not null default true,
  created_at    timestamptz not null default now()
);

create table public.students (
  id           uuid primary key default gen_random_uuid(),
  class_id     uuid not null references public.classes(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  anon_code    text not null,                       -- e.g. "S07": what graders and insight views use instead of names
  created_at   timestamptz not null default now(),
  unique (class_id, display_name),
  unique (class_id, anon_code)
);

create table public.submissions (
  id          uuid primary key default gen_random_uuid(),
  test_id     uuid not null references public.tests(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  status      text not null default 'uploaded'
              check (status in ('uploaded', 'queued', 'reading', 'grading', 'graded', 'failed', 'approved')),
  total       numeric,
  max_total   numeric,
  risk        text check (risk in ('low', 'medium', 'high')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (test_id, student_id)
);

create table public.pages (
  id             uuid primary key default gen_random_uuid(),
  submission_id  uuid not null references public.submissions(id) on delete cascade,
  page_no        int not null check (page_no >= 1),
  storage_path   text not null,
  media_type     text not null check (media_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  width          int,
  height         int,
  created_at     timestamptz not null default now(),
  unique (submission_id, page_no)
);

-- One row per attempt to read + grade a submission (the "job"). Keeps full diagnostics.
create table public.grading_runs (
  id             uuid primary key default gen_random_uuid(),
  submission_id  uuid not null references public.submissions(id) on delete cascade,
  status         text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  read_result    jsonb,          -- reader output (transcription, formulas, line boxes); name stripped before grading
  models         jsonb,          -- which free model did each step
  timings_ms     jsonb,
  attempts       jsonb,          -- models skipped / failed before success
  error          text,
  started_at     timestamptz,
  finished_at    timestamptz,
  created_at     timestamptz not null default now()
);

create table public.question_results (
  id             uuid primary key default gen_random_uuid(),
  submission_id  uuid not null references public.submissions(id) on delete cascade,
  q              int not null,
  max            numeric not null,
  score_a        numeric not null,
  score_b        numeric not null,
  ai_score       numeric not null,                 -- provisional: average of the two gradings (verifier)
  risk           text not null check (risk in ('low', 'medium', 'high')),
  flags          text[] not null default '{}',
  answer         jsonb,                            -- text, formulas, diagram, line boxes, page
  grade_a        jsonb,
  grade_b        jsonb,
  teacher_score  numeric,                          -- set when the teacher adjusts
  teacher_note   text check (char_length(teacher_note) <= 1000),
  approved       boolean not null default false,
  approved_at    timestamptz,
  approved_by    uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  unique (submission_id, q)
);

-- Audit log: every human decision on a mark (responsible-AI requirement).
create table public.review_events (
  id                  uuid primary key default gen_random_uuid(),
  question_result_id  uuid not null references public.question_results(id) on delete cascade,
  actor_id            uuid references auth.users(id),
  action              text not null check (action in ('approve', 'adjust', 'bulk_approve', 'unapprove')),
  from_score          numeric,
  to_score            numeric,
  note                text check (char_length(note) <= 1000),
  created_at          timestamptz not null default now()
);

-- Class-level outputs: misconception map, re-teach plan + worksheet, re-test.
create table public.insights (
  id          uuid primary key default gen_random_uuid(),
  test_id     uuid not null references public.tests(id) on delete cascade,
  kind        text not null check (kind in ('misconceptions', 'reteach', 'retest')),
  payload     jsonb not null,
  model       text,
  created_at  timestamptz not null default now()
);

-- Daily counters for free-tier protection (per visitor / per test). Server-only.
create table public.usage_counters (
  day      date not null default current_date,
  bucket   text not null,                          -- e.g. 'upload:ip:<hash>' or 'grade:test:<id>'
  count    int not null default 0,
  primary key (day, bucket)
);

create index on public.tests (class_id);
create index on public.students (class_id);
create index on public.submissions (test_id, status);
create index on public.pages (submission_id);
create index on public.grading_runs (submission_id, created_at desc);
create index on public.question_results (submission_id);
create index on public.review_events (question_result_id, created_at desc);
create index on public.insights (test_id, kind, created_at desc);

-- ---------------------------------------------------------------- helpers
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger submissions_touch before update on public.submissions
  for each row execute function public.touch_updated_at();

-- True when the current user owns the class. SECURITY DEFINER so policies on child tables don't recurse through RLS.
create or replace function public.owns_class(cid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.classes c where c.id = cid and c.owner_id = auth.uid())
$$;
create or replace function public.is_sample_class(cid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.classes c where c.id = cid and c.is_sample)
$$;
create or replace function public.class_of_test(tid uuid) returns uuid
  language sql stable security definer set search_path = public as $$ select class_id from public.tests where id = tid $$;
create or replace function public.class_of_submission(sid uuid) returns uuid
  language sql stable security definer set search_path = public as $$
  select t.class_id from public.submissions s join public.tests t on t.id = s.test_id where s.id = sid
$$;
create or replace function public.class_of_question_result(qid uuid) returns uuid
  language sql stable security definer set search_path = public as $$
  select public.class_of_submission(submission_id) from public.question_results where id = qid
$$;

-- ---------------------------------------------------------------- row level security
alter table public.classes          enable row level security;
alter table public.tests            enable row level security;
alter table public.students         enable row level security;
alter table public.submissions      enable row level security;
alter table public.pages            enable row level security;
alter table public.grading_runs     enable row level security;
alter table public.question_results enable row level security;
alter table public.review_events    enable row level security;
alter table public.insights         enable row level security;
alter table public.usage_counters   enable row level security;   -- no policies: server (secret key) only

-- classes
create policy classes_owner_all on public.classes for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid() and not is_sample);
create policy classes_sample_read on public.classes for select to anon, authenticated using (is_sample);

-- tests
create policy tests_owner_all on public.tests for all to authenticated
  using (public.owns_class(class_id)) with check (public.owns_class(class_id));
create policy tests_sample_read on public.tests for select to anon, authenticated using (public.is_sample_class(class_id));

-- students
create policy students_owner_all on public.students for all to authenticated
  using (public.owns_class(class_id)) with check (public.owns_class(class_id));
create policy students_sample_read on public.students for select to anon, authenticated using (public.is_sample_class(class_id));

-- submissions
create policy submissions_owner_all on public.submissions for all to authenticated
  using (public.owns_class(public.class_of_test(test_id))) with check (public.owns_class(public.class_of_test(test_id)));
create policy submissions_sample_read on public.submissions for select to anon, authenticated
  using (public.is_sample_class(public.class_of_test(test_id)));

-- pages, grading_runs, question_results: owners read (writes come from the server job), sample readable
create policy pages_owner_read on public.pages for select to authenticated
  using (public.owns_class(public.class_of_submission(submission_id)));
create policy pages_sample_read on public.pages for select to anon, authenticated
  using (public.is_sample_class(public.class_of_submission(submission_id)));

create policy runs_owner_read on public.grading_runs for select to authenticated
  using (public.owns_class(public.class_of_submission(submission_id)));
create policy runs_sample_read on public.grading_runs for select to anon, authenticated
  using (public.is_sample_class(public.class_of_submission(submission_id)));

create policy results_owner_read on public.question_results for select to authenticated
  using (public.owns_class(public.class_of_submission(submission_id)));
create policy results_owner_update on public.question_results for update to authenticated
  using (public.owns_class(public.class_of_submission(submission_id)))
  with check (public.owns_class(public.class_of_submission(submission_id)));
create policy results_sample_read on public.question_results for select to anon, authenticated
  using (public.is_sample_class(public.class_of_submission(submission_id)));

-- review_events: owners read + append their own decisions; never edit or delete history
create policy events_owner_read on public.review_events for select to authenticated
  using (public.owns_class(public.class_of_question_result(question_result_id)));
create policy events_owner_insert on public.review_events for insert to authenticated
  with check (actor_id = auth.uid() and public.owns_class(public.class_of_question_result(question_result_id)));

-- insights
create policy insights_owner_read on public.insights for select to authenticated
  using (public.owns_class(public.class_of_test(test_id)));
create policy insights_sample_read on public.insights for select to anon, authenticated
  using (public.is_sample_class(public.class_of_test(test_id)));

-- The upload token is a secret: hide it from the sample (anon) view; owners read it through the server.
revoke select (upload_token) on public.tests from anon;

-- ---------------------------------------------------------------- storage: private bucket for page images
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pages', 'pages', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;
-- No storage policies on purpose: only the server (secret key) reads/writes; the browser gets short-lived signed URLs.
