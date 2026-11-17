-- 0009: practice mode. Students (or anyone with a practice link) answer questions and get instant feedback that
-- doesn't count as a grade. Typed or photographed answers; photos are not stored.

alter table public.tests add column practice_open boolean not null default false;
alter table public.tests add column practice_token text not null default encode(gen_random_bytes(16), 'hex');
create unique index tests_practice_token_key on public.tests (practice_token);
-- practice_open is readable like the other test columns; practice_token stays server-only (see 0002)
grant select (practice_open) on public.tests to anon, authenticated;

create table public.practice_attempts (
  id          uuid primary key default gen_random_uuid(),
  test_id     uuid not null references public.tests(id) on delete cascade,
  student_id  uuid references public.students(id) on delete set null,   -- optional: students may practise anonymously
  mode        text not null check (mode in ('typed', 'photo')),
  questions   int[] not null,
  score       numeric not null,
  max         numeric not null,
  result      jsonb not null,      -- per question: mark, criteria met/missed with reasons and evidence, misconceptions
  models      jsonb,
  created_at  timestamptz not null default now()
);
create index on public.practice_attempts (test_id, created_at desc);
alter table public.practice_attempts enable row level security;
create policy practice_owner_read on public.practice_attempts for select to authenticated
  using (public.owns_class(public.class_of_test(test_id)));
revoke insert, update, delete on public.practice_attempts from anon, authenticated;   -- written by the server only
