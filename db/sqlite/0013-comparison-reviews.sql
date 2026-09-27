-- A model's reading of one comparison.
--
-- The pixel score says THAT a screen differs; it cannot say WHAT differs, and a
-- missing control in a dense table scores under 1%
-- (knowledge/decisions/the-diff-is-pixels-only.md). A vision model reads the
-- two screenshots and the diff and says what changed, in words, per region.
--
-- It sits BESIDE the comparison and never changes its numbers. The pixel score
-- stays the auditable, deterministic measure; this is a second opinion about
-- it, and a second opinion that disagreed with itself between runs must not be
-- able to move a score (knowledge/decisions/a-model-reads-what-the-pixels-flag.md).
--
-- One review per comparison. A comparison is one baseline/target PAIR, so a
-- re-pushed screenshot is a new pair and gets a new review, and re-pushing the
-- same image never pays for a second one.
--
-- `model` and `prompt_version` are kept so a review written by a different
-- model or prompt can be told apart from, and re-run against, the current one.
create table "comparison_review" (
  "comparison_id"   text not null primary key references "comparison" ("comparison_id") on delete cascade,
  "project_id"      text not null references "project" ("project_id") on delete cascade,
  "status"          text not null check ("status" in ('done', 'failed')),
  -- Null when the review failed.
  "verdict"         text check ("verdict" in ('matches', 'cosmetic', 'functional')),
  "summary"         text,
  -- JSON array of findings; read whole with the review, never queried into.
  "findings"        text not null default '[]',
  "error"           text,
  "model"           text not null,
  "prompt_version"  text not null,
  "created_at"      text not null
);

create index "comparison_review_project_idx" on "comparison_review" ("project_id", "verdict");
