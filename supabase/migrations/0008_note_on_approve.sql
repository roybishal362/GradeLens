-- 0008: a teacher's note is saved when they approve a mark too (not only when they change it).
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
         teacher_note  = case when act <> 'unapprove' and note is not null then nullif(note, '') else teacher_note end,
         approved      = act <> 'unapprove',
         approved_at   = case when act <> 'unapprove' then now() end,
         approved_by   = case when act <> 'unapprove' then auth.uid() end
   where id = qid;
  perform public.refresh_submission(r.submission_id);
end $$;
revoke execute on function public.review_mark(uuid, text, numeric, text) from public, anon;
grant execute on function public.review_mark(uuid, text, numeric, text) to authenticated;
