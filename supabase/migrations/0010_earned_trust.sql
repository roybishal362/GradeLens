-- 0010: GradeLens has to EARN bulk approval, question by question (see src/lib/trust.ts for the reasoning and the
-- evaluation behind it). Mirrors MIN_CHECKED = 5 and MIN_KEPT_RATE = 0.9 in src/lib/trust.ts: keep them in sync.

-- A question's track record in one test: written answers the teacher decided one by one (blanks and answers whose
-- latest decision was a bulk approval say nothing about the teacher's judgement).
-- SECURITY INVOKER on purpose: Row Level Security decides whose results are counted (owners: their own tests;
-- anyone: the public sample class).
create or replace function public.question_track(tid uuid)
  returns table (q int, checked int, kept int, close int)
  language sql stable set search_path = public as $$
  select qr.q,
         count(*)::int,
         count(*) filter (where coalesce(qr.teacher_score, qr.ai_score) = qr.ai_score)::int,
         count(*) filter (where abs(coalesce(qr.teacher_score, qr.ai_score) - qr.ai_score) <= 0.5)::int
    from public.question_results qr
    join public.submissions s on s.id = qr.submission_id
    left join lateral (
      select e.action from public.review_events e where e.question_result_id = qr.id order by e.created_at desc limit 1
    ) last on true
   where s.test_id = tid and qr.approved
     and btrim(coalesce(qr.answer->>'text', '')) <> ''
     and coalesce(last.action, '') <> 'bulk_approve'
   group by qr.q
$$;
revoke execute on function public.question_track(uuid) from public;
grant execute on function public.question_track(uuid) to anon, authenticated;

create or replace function public.is_mcq(tid uuid, qn int) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tests t, jsonb_array_elements(t.rubric->'questions') x
     where t.id = tid and (x->>'q')::int = qn and x->>'type' = 'mcq')
$$;
revoke execute on function public.is_mcq(uuid, int) from public, anon, authenticated;

-- Bulk approval now only touches ready marks on questions that have earned it (or multiple choice, marked by code),
-- and never a written answer marked 0. Optional qn: approve one question's ready marks.
drop function if exists public.bulk_approve(uuid, uuid);
create or replace function public.bulk_approve(tid uuid, sid uuid default null, qn int default null) returns int
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.owns_class(public.class_of_test(tid)) then raise exception 'not allowed' using errcode = '42501'; end if;
  with track as (select * from public.question_track(tid)),
  targets as (
    select qr.id, coalesce(qr.teacher_score, qr.ai_score) as cur, qr.submission_id
      from public.question_results qr join public.submissions s on s.id = qr.submission_id
     where s.test_id = tid and (sid is null or s.id = sid) and (qn is null or qr.q = qn)
       and not qr.approved and qr.risk = 'low' and s.status in ('graded', 'approved')
       and (public.is_mcq(tid, qr.q)
            or (qr.ai_score > 0 and exists (select 1 from track t where t.q = qr.q and t.checked >= 5 and t.kept >= 0.9 * t.checked)))
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
revoke execute on function public.bulk_approve(uuid, uuid, int) from public, anon;
grant execute on function public.bulk_approve(uuid, uuid, int) to authenticated;

-- The harsh-mark guard for marks already waiting (new ones get it in the grading job): a written answer marked 0 is
-- never "ready". Teacher decisions are left alone.
update public.question_results qr
   set risk = 'medium',
       flags = array_append(array_remove(qr.flags, '0 marks for a written answer: check it'), '0 marks for a written answer: check it')
  from public.submissions s
 where s.id = qr.submission_id and not qr.approved and qr.ai_score = 0
   and btrim(coalesce(qr.answer->>'text', '')) <> '' and not public.is_mcq(s.test_id, qr.q);

update public.submissions s
   set risk = x.risk
  from (select submission_id,
               case max(case risk when 'high' then 2 when 'medium' then 1 else 0 end) when 2 then 'high' when 1 then 'medium' else 'low' end as risk
          from public.question_results group by submission_id) x
 where x.submission_id = s.id and s.risk is distinct from x.risk;
