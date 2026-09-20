-- Milestone 02 — legacy baselines land.
--
-- What a screenshot is OF, and which run it came from. A shot is pinned to a
-- route, a state, a viewport and a side; everything a comparison needs to know
-- that two images are of the same thing is a foreign key here, not a convention
-- in a CLI.

-- A rebuild. The legacy app is NOT one of these.
--
-- That asymmetry is the point. Legacy is the thing being measured against, not
-- a competitor in the same race — modelling it as "the branch called legacy"
-- makes `branch vs branch` expressible, and the moment it is expressible
-- someone will score two rebuilds against each other and call the winner done.
create table "branch" (
  "branch_id"   text not null primary key,
  "project_id"  text not null references "project" ("project_id") on delete cascade,
  "key"         text not null,
  "label"       text not null,
  "created_at"  text not null,
  "updated_at"  text not null
);

create unique index "branch_project_key_idx" on "branch" ("project_id", "key");

-- One condition a screen can be in: empty, populated, error, mid-validation.
--
-- `ref` is free text and is NEVER validated, never parsed, and never a foreign
-- key to a test framework. It is a note from the capturing repo to a human
-- reading the report — "the fixture that sets this up" — and the moment diffui
-- tries to resolve it, diffui is coupled to whatever that repo tests with.
create table "route_state" (
  "state_id"   text not null primary key,
  "route_id"   text not null references "route" ("route_id") on delete cascade,
  "key"        text not null,
  "label"      text not null,
  "ref"        text,
  "sort"       integer not null default 0,
  "created_at" text not null
);

create unique index "route_state_route_key_idx" on "route_state" ("route_id", "key");

-- One captured image.
--
-- `side` and `branch_id` are constrained together rather than trusted: a legacy
-- shot has no branch and a rebuild shot must have one. Written as a convention
-- in the upload function instead, the first other write path breaks it, and a
-- legacy shot carrying a branch silently becomes a rebuild that scores 100%
-- against itself.
--
-- `state_id` and `viewport_id` are foreign keys for the same reason: a client
-- cannot upload a screenshot at a resolution or in a state the project never
-- declared, so the report can never contain a row nobody agreed to.
--
-- `is_baseline` pins WHICH legacy shot everyone is scored against. Legacy still
-- runs and gets re-captured, so without it "the baseline" would drift to
-- whatever was uploaded last, and yesterday's percentages would stop meaning
-- what they meant.
create table "shot" (
  "shot_id"      text    not null primary key,
  "project_id"   text    not null references "project" ("project_id") on delete cascade,
  "route_id"     text    not null references "route" ("route_id") on delete cascade,
  "state_id"     text    not null references "route_state" ("state_id") on delete cascade,
  "viewport_id"  text    not null references "viewport" ("viewport_id") on delete cascade,
  "side"         text    not null check ("side" in ('legacy', 'new')),
  "branch_id"    text    references "branch" ("branch_id") on delete cascade,
  "content_key"  text    not null,
  "width"        integer not null,
  "height"       integer not null,
  "byte_size"    integer not null default 0,
  "is_baseline"  boolean not null default false,
  "captured_at"  text    not null,
  "created_at"   text    not null,

  check (
    ("side" = 'legacy' and "branch_id" is null)
    or
    ("side" = 'new' and "branch_id" is not null)
  )
);

-- How every read of this table is shaped: "the shots for this screen, in this
-- state, at this size".
create index "shot_coordinates_idx"
  on "shot" ("project_id", "route_id", "state_id", "viewport_id", "side");

-- At most one baseline per coordinate. A second would make "how far is this
-- rebuild" have two answers at once.
create unique index "shot_baseline_idx"
  on "shot" ("route_id", "state_id", "viewport_id")
  where "is_baseline" = true;
