-- 0006: found by the end-to-end test: deleting a teacher who had approved a mark failed
-- ("question_results_approved_by_fkey"), which would also break the 7-day guest clean-up and account deletion.
-- Who approved / who acted is kept as history while the user exists; when the account is deleted it becomes null
-- (their classes, scripts and marks are deleted by the classes -> ... cascade anyway).
alter table public.question_results drop constraint question_results_approved_by_fkey;
alter table public.question_results add constraint question_results_approved_by_fkey
  foreign key (approved_by) references auth.users(id) on delete set null;
alter table public.review_events drop constraint review_events_actor_id_fkey;
alter table public.review_events add constraint review_events_actor_id_fkey
  foreign key (actor_id) references auth.users(id) on delete set null;
