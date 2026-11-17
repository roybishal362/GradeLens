-- 0004: script-level warnings the teacher must see, e.g. "the name on the page (Maya) is not this student (Noah)",
-- or "an answer was labelled Q36, which is not on this test".
alter table public.submissions add column warnings text[] not null default '{}';
