-- 0003: job queue, tamper-proof review decisions, usage limits, guest clean-up, sample-class reference marks, re-tests.

-- ---------------------------------------------------------------- columns
-- The real teacher's mark from the public dataset. Only the sample class has it: visitors can compare GradeLens'
-- suggestion with what a real teacher gave.
alter table public.question_results add column reference_score numeric;

-- A re-test is generated from a test's misconceptions; learning gain compares the two.
alter table public.tests add column parent_test_id uuid references public.tests(id) on delete set null;
grant select (parent_test_id) on public.tests to anon, authenticated;   -- see 0002: column grants only on tests

alter table public.submissions add column source text not null default 'upload' check (source in ('upload', 'scan', 'sample'));
alter table public.submissions add column attempts int not null default 0;
alter table public.submissions add column error text check (char_length(error) <= 2000);

-- ---------------------------------------------------------------- job queue (server only)
-- Atomically claim a submission for grading. Also reclaims a job whose function died mid-way (no update for 6 minutes).
-- At most 3 automatic attempts; the teacher can reset them with a retry.
create or replace function public.claim_submission(sid uuid) returns boolean
  language sql security definer set search_path = public as $$
  with c as (
    update public.submissions
       set status = 'reading', attempts = attempts + 1, error = null
     where id = sid
       and attempts < 3
       and (status in ('uploaded', 'queued', 'failed')
            or (status in ('reading', 'grading') and updated_at < now() - interval '6 minutes'))
    returning 1
  )
  select exists (select 1 from c)
$$;

-- Daily usage counter with a limit: returns false once the bucket is over the limit (free-tier protection).
create or replace function public.bump_usage(b text, lim int) returns boolean
  language sql security definer set search_path = public as $$
  insert into public.usage_counters (day, bucket, count) values (current_date, b, 1)
  on conflict (day, bucket) do update set count = public.usage_counters.count + 1
  returning count <= lim
$$;

-- Guests (anonymous sign-ins) older than 7 days; the purge job deletes their scans, then the users (cascades).
create or replace function public.stale_guests() returns table (user_id uuid)
  language sql stable security definer set search_path = public, auth as $$
  select id from auth.users where is_anonymous and created_at < now() - interval '7 days'
$$;

revoke execute on function public.claim_submission(uuid) from public, anon, authenticated;
revoke execute on function public.bump_usage(text, int) from public, anon, authenticated;
revoke execute on function public.stale_guests() from public, anon, authenticated;
grant execute on function public.claim_submission(uuid) to service_role;
grant execute on function public.bump_usage(text, int) to service_role;
grant execute on function public.stale_guests() to service_role;

-- ---------------------------------------------------------------- review decisions (tamper-proof audit)
-- Teachers no longer update question_results directly: every decision goes through review_mark / bulk_approve,
-- which write the audit event and the mark in the same transaction. The audit log can't be bypassed.
drop policy if exists results_owner_update on public.question_results;
-- Submissions are created and updated only by the server (uploads, grading jobs, retries after an ownership check),
-- so totals always match the marks. Teachers can still read and delete their own.
revoke insert, update on public.submissions from anon, authenticated;
revoke update, insert, delete on public.question_results from anon, authenticated;
revoke insert, update, delete on public.review_events from anon, authenticated;
drop policy if exists events_owner_insert on public.review_events;

create or replace function public.refresh_submission(sid uuid) returns void
  language sql security definer set search_path = public as $$
  update public.submissions s
     set total = x.total,
         max_total = x.max_total,
         status = case when s.status in ('graded', 'approved')
                       then case when x.pending = 0 then 'approved' else 'graded' end
                       else s.status end
    from (select coalesce(sum(coalesce(teacher_score, ai_score)), 0) as total,
                 coalesce(sum(max), 0) as max_total,
                 count(*) filter (where not approved) as pending
            from public.question_results where submission_id = sid) x
   where s.id = sid
$$;
revoke execute on function public.refresh_submission(uuid) from public, anon, authenticated;
grant execute on function public.refresh_submission(uuid) to service_role;

-- act: 'approve' (accept the suggestion or the current teacher mark), 'adjust' (set a mark; also approves),
-- 'unapprove' (back to pending). Scores in half marks between 0 and the question's max.
create or replace function public.review_mark(qid uuid, act text, score numeric default null, note text default null)
  returns void language plpgsql security definer set search_path = public as $$
declare
  r public.question_results;
  cur numeric;
begin
  select * into r from public.question_results where id = qid for update;
  if r.id is null or not public.owns_class(public.class_of_submission(r.submission_id)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if act not in ('approve', 'adjust', 'unapprove') then raise exception 'unknown action %', act; end if;
  if act = 'adjust' and (score is null or score < 0 or score > r.max or score * 2 <> floor(score * 2)) then
    raise exception 'score must be in half marks between 0 and %', r.max;
  end if;
  if note is not null and char_length(note) > 1000 then raise exception 'note too long'; end if;
  cur := coalesce(r.teacher_score, r.ai_score);
  insert into public.review_events (question_result_id, actor_id, action, from_score, to_score, note)
  values (qid, auth.uid(), act, cur, case act when 'adjust' then score when 'approve' then cur end, note);
  update public.question_results
     set teacher_score = case when act = 'adjust' then score else teacher_score end,
         teacher_note  = case when act = 'adjust' and note is not null then note else teacher_note end,
         approved      = act <> 'unapprove',
         approved_at   = case when act <> 'unapprove' then now() end,
         approved_by   = case when act <> 'unapprove' then auth.uid() end
   where id = qid;
  perform public.refresh_submission(r.submission_id);
end $$;

-- Approve every pending low-risk suggestion of a test (or of one submission), one audit event per mark.
create or replace function public.bulk_approve(tid uuid, sid uuid default null) returns int
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.owns_class(public.class_of_test(tid)) then raise exception 'not allowed' using errcode = '42501'; end if;
  with targets as (
    select qr.id, coalesce(qr.teacher_score, qr.ai_score) as cur, qr.submission_id
      from public.question_results qr join public.submissions s on s.id = qr.submission_id
     where s.test_id = tid and (sid is null or s.id = sid) and not qr.approved and qr.risk = 'low'
       and s.status in ('graded', 'approved')
     for update of qr
  ), ev as (
    insert into public.review_events (question_result_id, actor_id, action, from_score, to_score)
    select id, auth.uid(), 'bulk_approve', cur, cur from targets
  ), up as (
    update public.question_results q set approved = true, approved_at = now(), approved_by = auth.uid()
      from targets t where q.id = t.id
    returning q.submission_id
  )
  select count(*) into n from up;
  perform public.refresh_submission(s.id) from public.submissions s where s.test_id = tid and (sid is null or s.id = sid);
  return n;
end $$;

revoke execute on function public.review_mark(uuid, text, numeric, text) from public, anon;
revoke execute on function public.bulk_approve(uuid, uuid) from public, anon;
grant execute on function public.review_mark(uuid, text, numeric, text) to authenticated;
grant execute on function public.bulk_approve(uuid, uuid) to authenticated;
