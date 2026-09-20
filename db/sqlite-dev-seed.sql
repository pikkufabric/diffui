-- Dev seed. `pikku db reset` applies this file after replaying the migrations;
-- it is the ONLY seed file the CLI reads, and the name is exact.

-- ---------------------------------------------------------------------------
-- A DEV API KEY, so the CLI can authenticate with no browser.
--
-- `diffui login` runs the RFC 8628 device flow, which needs a human to approve
-- a code in a browser. That is the right answer for an engineer and an
-- impossible one for a scripted local run — so this seeds a known key that
-- `DIFFUI_API_KEY` can carry instead. It is the LOCAL half of
-- knowledge/questions/how-should-ci-authenticate.md, not the production one:
-- the value is fixed, public, and lives only in dev seed data.
--
-- THE KEY:  diffui_dev_local_only_0000000000000000
--
-- The `key` column below is NOT that string. @better-auth/api-key stores
-- `base64url(sha256(key))` without padding (`defaultKeyHasher`), and its verify
-- path hashes the presented key the same way before looking it up — so a
-- plaintext row would verify against nothing. The value here was derived with
-- the library's own algorithm rather than invented.
--
-- `reference_id` is the OWNER, and it is deliberately not called `user_id`:
-- the verify path reads ownership off this column, so a key with the wrong one
-- verifies perfectly and then resolves to nobody — a 401 with nothing in the
-- logs to explain it.
--
-- `remaining` is left NULL, which is "no quota on this key" and is a SEPARATE
-- feature from the rate limit: `remaining` is a lifetime budget, the rate limit
-- is per window.
--
-- `rate_limit_max` / `rate_limit_time_window` are spelled out here rather than
-- left NULL, and they mirror the auth.ts values on purpose. The plugin only
-- uses its configured numbers as defaults stamped onto a key when it ISSUES
-- one; the verify path reads these columns alone, so a seeded row with them
-- NULL would silently skip the limit and dev would never exercise the path
-- production runs on. A fresh `pikku db reset` rewrites the row, so the dev key
-- cannot exhaust itself into a wall nobody can explain.
-- ---------------------------------------------------------------------------

insert into "user" ("id", "name", "email", "email_verified", "created_at", "updated_at", "actor", "banned", "fabric")
values (
  '00000000-0000-4000-8000-0000000d0001',
  'diffui dev',
  'dev@diffui.local',
  1,
  '2026-01-01T00:00:00.000Z',
  '2026-01-01T00:00:00.000Z',
  0,
  0,
  0
)
on conflict ("id") do nothing;

insert into "apikey" (
  "id", "config_id", "name", "start", "reference_id", "prefix", "key",
  "enabled", "rate_limit_enabled", "rate_limit_max", "rate_limit_time_window",
  "request_count", "created_at", "updated_at"
)
values (
  '00000000-0000-4000-8000-00000000key1',
  'default',
  'diffui dev key',
  'diffui',
  '00000000-0000-4000-8000-0000000d0001',
  'diffui_dev',
  -- base64url(sha256('diffui_dev_local_only_0000000000000000')), unpadded
  'QzXJHfl0LowwgsNVsYfds2Vmb7Hi1feE1pb8McfJ154',
  1,
  1,
  10000,
  86400000, -- 24h in ms, the same window as auth.ts
  0,
  '2026-01-01T00:00:00.000Z',
  '2026-01-01T00:00:00.000Z'
)
on conflict ("id") do nothing;
