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

## Where things are

| | |
| --- | --- |
| `knowledge/` | what the app is, and why — read this first |
| `packages/functions/src/` | functions, personas, services |
| `apps/app/` | the React frontend |
| `db/sqlite/` | migrations |
| `.claude/skills/` | how Pikku works — the spec, not documentation |
