-- Milestone 01 — a project and its routes.
--
-- The spine: a project owned by an ORGANISATION (never a user), the resolutions
-- it captures at, and the screens it tracks. States, shots and comparisons
-- arrive with the milestones that first need them.

-- One legacy app and the rebuilds chasing it.
--
-- `organization_id` is on the table from the first migration rather than added
-- later, because tenancy retrofitted onto rows written without it means
-- deciding retrospectively who owns each one.
--
-- `baseline_label` / `target_label` exist so a team that says "v1" and "v2"
-- reads its own words back. They change what the screens say and nothing else.
create table "project" (
  "project_id"      text    not null primary key,
  "organization_id" text    not null references "organization" ("id") on delete cascade,
  "slug"            text    not null,
  "name"            text    not null,
  "baseline_label"  text    not null default 'legacy',
  "target_label"    text    not null default 'new',
  "created_at"      text    not null,
  "updated_at"      text    not null
);

-- Two organisations may both track an app they both call `bb2`.
create unique index "project_organization_slug_idx" on "project" ("organization_id", "slug");

-- A declared resolution. Seeded desktop/tablet/mobile when a project is created:
-- a project with no resolution cannot accept a shot, and making someone invent
-- three before they can do anything is ceremony.
--
-- A shot references one of these by foreign key rather than carrying a free-text
-- size, which is what stops two branches being scored at different resolutions
-- and then ranked against each other.
create table "viewport" (
  "viewport_id"         text    not null primary key,
  "project_id"          text    not null references "project" ("project_id") on delete cascade,
  "key"                 text    not null,
  "label"               text    not null,
  "width"               integer not null,
  "height"              integer not null,
  "device_scale_factor" real    not null default 1,
  "sort"                integer not null default 0,
  "created_at"          text    not null
);

create unique index "viewport_project_key_idx" on "viewport" ("project_id", "key");

-- A screen, identified by NAME rather than by URL.
--
-- That is the load-bearing decision. Legacy addresses a screen as
-- `/#/product-library/:id/summary` and the rebuild as `/app/products/$productId`;
-- they share no string, so a URL cannot be the identity if the two sides are
-- ever to be paired. The name is the identity and both paths hang off it.
--
-- `legacy_path` NULL and `legacy_absent` are DIFFERENT claims and the coverage
-- report must never merge them:
--   legacy_path set              -> legacy has this screen
--   legacy_path NULL, absent 0   -> nobody has mapped it yet (an open question)
--   legacy_path NULL, absent 1   -> legacy genuinely does not have it (a fact)
-- A report that collapses the middle row into the bottom one tells you a rebuild
-- is finished when nobody has checked.
create table "route" (
  "route_id"      text    not null primary key,
  "project_id"    text    not null references "project" ("project_id") on delete cascade,
  "key"           text    not null,
  "label"         text    not null,
  "legacy_path"   text,
  "new_path"      text,
  "legacy_absent" boolean not null default false,
  "sort"          integer not null default 0,
  "created_at"    text    not null,
  "updated_at"    text    not null
);

-- The key is the identity, so it is unique per project and `declareRoutes`
-- upserts on it — re-running init against an edited inventory updates rather
-- than duplicating.
create unique index "route_project_key_idx" on "route" ("project_id", "key");

create index "route_project_sort_idx" on "route" ("project_id", "sort");
