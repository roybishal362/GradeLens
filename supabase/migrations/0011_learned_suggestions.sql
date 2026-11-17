-- 0011: trust is measured on the suggestions as they are NOW. After "Re-mark the rest", suggestions follow the
-- teacher's standard (learned = true), so decisions on the earlier, uncalibrated suggestions stop counting.
alter table public.question_results add column if not exists learned boolean not null default false;

-- The public sample class: its 15 waiting scripts were marked with the teacher's standard learned from the first 5.
update public.question_results qr set learned = true
  from public.submissions s join public.tests t on t.id = s.test_id join public.classes c on c.id = t.class_id
 where s.id = qr.submission_id and c.is_sample and not qr.approved;
-- ...and the teachers' copies of it (same marks, copied by copySampleClass)
update public.question_results qr set learned = true
  from public.submissions s
 where s.id = qr.submission_id and s.source = 'sample' and not qr.approved;

create or replace function public.question_track(tid uuid)
  returns table (q int, checked int, kept int, close int)
  language sql stable set search_path = public as $$
  with mine as (
    select qr.* from public.question_results qr join public.submissions s on s.id = qr.submission_id where s.test_id = tid
  ), gen as (select exists (select 1 from mine where learned) as any_learned)
  select m.q,
         count(*)::int,
         count(*) filter (where coalesce(m.teacher_score, m.ai_score) = m.ai_score)::int,
         count(*) filter (where abs(coalesce(m.teacher_score, m.ai_score) - m.ai_score) <= 0.5)::int
    from mine m cross join gen
    left join lateral (
      select e.action from public.review_events e where e.question_result_id = m.id order by e.created_at desc limit 1
    ) last on true
   where m.approved
     and btrim(coalesce(m.answer->>'text', '')) <> ''
     and coalesce(last.action, '') <> 'bulk_approve'
     and (m.learned or not gen.any_learned)
   group by m.q
$$;
revoke execute on function public.question_track(uuid) from public;
grant execute on function public.question_track(uuid) to anon, authenticated;
