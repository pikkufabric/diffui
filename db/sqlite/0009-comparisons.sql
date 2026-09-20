-- Milestone 03 — a rebuild is scored.
--
-- One pixel comparison of one rebuild shot against the legacy baseline for the
-- same screen, state and resolution.

-- `baseline_shot_id` is always a legacy shot and `target_shot_id` always a
-- branch shot. Nothing here can express branch-against-branch, which is
-- deliberate: the question this tool answers is "how far is this rebuild from
-- the app it replaces", and two rebuilds agreeing with each other is not an
-- answer to it.
--
-- `compared_pixels` is stored alongside `diff_pixels` so the percentage is
-- auditable rather than asserted — a reader can divide the two themselves and
-- see what the number was computed from.
--
-- `status` carries `size-mismatch` as a first-class outcome. Two images of
-- different dimensions are NEVER resized or padded to make them comparable:
-- that manufactures a number out of an unanswered question, and a rebuild at
-- the wrong viewport would score respectably instead of reporting the real
-- problem.
create table "comparison" (
  "comparison_id"    text    not null primary key,
  "project_id"       text    not null references "project" ("project_id") on delete cascade,
  "baseline_shot_id" text    not null references "shot" ("shot_id") on delete cascade,
  "target_shot_id"   text    not null references "shot" ("shot_id") on delete cascade,
  "status"           text    not null check ("status" in ('identical', 'different', 'size-mismatch')),
  "diff_pixels"      integer not null default 0,
  "compared_pixels"  integer not null default 0,
  "diff_ratio"       real    not null default 0,
  "diff_content_key" text,
  "created_at"       text    not null
);

-- One comparison per pair; re-pushing a shot replaces its verdict rather than
-- appending a second one.
create unique index "comparison_pair_idx"
  on "comparison" ("baseline_shot_id", "target_shot_id");

create index "comparison_project_idx" on "comparison" ("project_id", "status");
