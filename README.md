# diffui

Visual regression between a **legacy app** and the **rebuilds** replacing it.

A rebuild is only finished when it looks like the thing it replaces. diffui
answers two questions, screen by screen and resolution by resolution:

- **How far off is this rebuild?** — a pixel diff against the legacy baseline.
- **What has nobody built yet?** — routes legacy has that a rebuild has no
  screenshot for.

## The shape of it

Screenshots are captured by the consuming repo — whatever it already uses,
Playwright or otherwise — and pushed here by CLI. diffui stores them, diffs each
rebuild against the pinned legacy baseline, and reports the result.

- **Legacy is singular.** It is the baseline, never a branch.
- **A branch is one rebuild** — `mantine`, `shadcn`, a second attempt. Branches
  are compared against legacy, **never against each other**. You compare their
  scores, not their pixels.
- **A route is a name, not a URL** — `company.add-user` — carrying the legacy
  path and the new path. That is what lets the two sides pair when their routing
  has nothing in common.
- **A state is a named state of a route** — a dialog open, a tab selected. Shots
  reference declared states by foreign key, so nothing can upload a screenshot
  of a state nobody declared.
- **Viewports are per project**, seeded desktop / tablet / mobile.

## What it deliberately is not

- **Not a semantic diff.** Pixels only. A pixel score tells you *that* a screen
  differs, never *what* is missing — coverage answers that instead.
- **Not masked, yet.** Timestamps and generated ids put a noise floor under
  every score, so read scores as relative: 40% → 12% is progress; 12% is not
  "12% wrong". Masks are a later milestone, and legacy still runs, so baselines
  are cheap to recapture when they arrive.
- **Not a capture tool.** It stores and compares; the consuming repo drives the
  browser. That is what keeps it framework-agnostic.

## Running it

```sh
bun install
bunx --bun pikku bootstrap
bun run prebuild && bun run dev
```

The API comes up on `:3000` and the app on `:7104`.

## Using it from a terminal

Everything the web app does, the `diffui` CLI (`packages/cli`) does too — no
browser needed at any step:

```sh
diffui signup --email me@example.com          # or: diffui login [--email …]
diffui projects create shop --name "Shop"
diffui init routes.json --project shop
diffui push legacy-manifest.json --project shop
diffui push mantine-manifest.json --project shop --branch mantine
diffui overview
diffui report  --project shop --branch mantine [--fail-over 5]
diffui compare --project shop --branch mantine --route home --out ./diffs
diffui review  --project shop --branch mantine   # a model says what differs
```

`diffui help` lists every command. Read commands take `--json`, and
`report --fail-over <percent>` exits 2 when any screen is further off than that,
for CI. Passwords come from `$DIFFUI_PASSWORD`, stdin, or a hidden prompt.

In the repo doing the rebuild, `diffui skill install` adds the diffui skill to
`.claude/skills/diffui/`. It gives a coding agent the whole loop: a shoot config
listing every screen and dialog, a Playwright shooter that signs in without
writing credentials anywhere, a check that refuses stale or redirected captures
before they are pushed, and the traps that cost past migrations an afternoon
each. The skill ships from `packages/cli/skill/diffui/`.

`review` (or `push --review`) has a vision model read each flagged screen and
list what differs. It needs an AI gateway: Fabric provides one, and locally
`pikku dev` uses `OPENAI_BASE_URL` / `OPENAI_API_KEY` from `.env`. The pixel
score never changes because of it — see
`knowledge/decisions/a-model-reads-what-the-pixels-flag.md`.

## Where things are

| | |
| --- | --- |
| `knowledge/` | what the app is, and why — read this first |
| `packages/functions/src/` | functions, personas, services |
| `apps/app/` | the React frontend |
| `db/sqlite/` | migrations |
| `.claude/skills/` | how Pikku works — the spec, not documentation |
