---
name: diffui
description: 'Use when rebuilding an existing app and you need proof the new screens look like the old ones: discovering every screen, dialog, menu and tab of both apps by crawling them, pairing the two sides, photographing them, pushing the shots to diffui, and reading back how far each screen is from legacy, what the rebuild has not built yet, and what a model says differs. Covers read-only versus writes discovery, sign-in without leaking credentials, desktop and phone widths, the pre-push provenance check, and scores against their noise floor. TRIGGER when: the user asks whether the rebuild looks like the old app, for pixel parity or a visual diff between legacy and new, to screenshot or crawl both apps and compare, to push screenshots to diffui, to set up diffui in this repo, or asks what screens are still missing or most different. DO NOT TRIGGER when: comparing two rebuilds with each other, for a behavioural unit or e2e test, or for snapshot tests within one app.'
---

# diffui — does the rebuild look like the app it replaces?

diffui stores screenshots of a **legacy** app and of each **rebuild** (a branch), compares every
rebuild screen against legacy at each resolution, and answers two questions separately:

- **How far off is each screen?** A pixel score. It says THAT a screen differs.
- **What has nobody built yet?** Coverage: screens legacy has that the rebuild never pushed.

On request a model reads each flagged screen and says **what** differs: a missing button, a renamed
column. The pixel score never changes because of it.

"It looks the same" is not an answer anybody can check. This skill turns it into one.

## The loop

```bash
S=<this skill's dir>/scripts

# 1. find everything, on each side — asks for credentials, needs --mode (below)
node $S/discover.mjs --config shoot.json --side legacy --mode read-only
node $S/discover.mjs --config shoot.json --side new    --mode read-only

# 2. match the two sides into a draft, then REVIEW it with the user
node $S/pair.mjs --config shoot.json discovery/legacy.json discovery/new.json --out shoot.json

# 3. declare the screens (once, and again when the list changes)
diffui login                                        # or DIFFUI_API_KEY in CI
diffui projects create <slug> --name "<App>"        # seeds desktop / tablet / mobile
node $S/routes.mjs shoot.json > routes.json
diffui init routes.json --project <slug>

# 4. legacy: once, and again only when legacy itself changes
node $S/shoot.mjs --config shoot.json --side legacy --out shots/legacy
node $S/check.mjs --config shoot.json shots/legacy/manifest.json
diffui push shots/legacy/manifest.json --project <slug>

# 5. the rebuild: every time it changes
node $S/shoot.mjs --config shoot.json --side new --out shots/new --workers 4
node $S/check.mjs --config shoot.json shots/legacy/manifest.json shots/new/manifest.json --since <rebuild src>
diffui push shots/new/manifest.json --project <slug> --review
diffui report  --project <slug> --branch <branch>
diffui compare --project <slug> --branch <branch> --route <key> [--state <key>] [--viewport <key>] --out diffs/
```

Then fix, re-shoot only what changed (`--only key,key`), check, push, and read the report again.
A re-shoot merges into the manifest and drops shots the config no longer asks for. Re-run
discovery when screens are added, not on every change.

## Discovery: read-only or writes — the user chooses, every run

`discover.mjs` works on any app a browser can open. It crawls every same-origin link (collapsing
`/orders/10421` and `/orders/10420` into `/orders/:id`), then on each screen clicks every button,
tab, menu trigger and hover-only row control, each on a fresh copy of the page, and records what
appeared: a dialog, menu, listbox, tab, validation error, or the result of a write.

There is no default mode. **Ask the user which, and say what each costs:**

- **`--mode read-only`** blocks every request that is not a GET, so clicking "Delete" deletes
  nothing. Safe against anything, production included. It finds panels, dialogs, menus, tabs and
  validation, but never what a write leads to ("Order archived").
  - An app that **reads with POST** (GraphQL, RPC; every Pikku app) comes up with empty pages,
    because its reads are blocked too. The run lists every blocked request. Add the read URLs to
    `sides.<side>.readOnly.allow` (e.g. `["/rpc/list", "/rpc/get"]`) and run again.
- **`--mode writes`** clicks through for real, to capture results too. **Staging only, with
  disposable data**: deletes delete, and emails, webhooks and test payments may really go out. It
  prints that warning and makes the user type the host (or pass `--confirm-host <host>` when
  there is no terminal). The states it finds that way are marked `mutates`, and `shoot.mjs` skips
  them unless given the same `--confirm-host`, because photographing them writes again.

Either way, "Log out" and "Sign out" are never clicked and logout links never followed. Add
anything else that must never be touched to `sides.<side>.discover.skip` (regexes over the
control's name). Discovery starts where signing in lands; `sides.<side>.start` overrides it.

## Pairing, and the review that follows it

`pair.mjs` matches the two discoveries on what a person sees: page title and heading, section
headings, buttons, and the words in the path. Words on nearly every screen of a side (the app name,
the nav) are ignored. Panels are paired within a screen by kind and title. Every pair carries its
score and evidence, and anything below the bar is left unpaired rather than guessed.

**Go through its "for a person to confirm" list with the user before shooting:**

- Two screens that are the same but share no words ("Dashboard" and "Home") come out as one
  legacy-only and one rebuild-only. Merge them.
- A rebuild-only screen: does legacy really lack it (`"legacyAbsent": true`), or was it missed?
- A legacy-only screen or panel: not built yet, or discovery missed the rebuild's version?
- An `:id` screen: both example records must be **the same** record, or two different orders are
  compared.

## Before the first run, ask the user three things

1. **Read-only or writes** for discovery, per side (above). Legacy is often production: read-only.
2. **Which widths.** The user picks; you do not assume. Offer desktop and mobile. A rebuild that
   matches at 1440 and collapses at 390 has not matched. Sizes come from the diffui project
   (`diffui projects show <slug>`); the config only names the keys.
3. **How to sign in to each side.** Ask once, at the start, and say which host each credential is
   for. Credentials come from the environment (`LEGACY_USER`, `LEGACY_PASS`, `LEGACY_TOKEN`,
   `NEW_USER`, `NEW_PASS`, `NEW_TOKEN`) or a hidden prompt. **Never** put one in `shoot.json`, a
   flag, a commit, or a subagent's prompt. Use accounts in the **same state** on both sides:
   entitlements, banners and data all move the pixels.

## The shoot config

`example/shoot.json` is a complete one. Start from its `project`, `viewports` and `sides`;
`pair.mjs` writes the `screens`. It is the single list of screens: `routes.mjs` declares them to
diffui and `shoot.mjs` photographs them, so the two cannot drift.

- A screen is a **name** (`orders.detail`) with a `legacyPath` and a `newPath`. The name is what
  pairs the two sides; the paths never have to look alike.
- `legacyAbsent: true` is a **claim** that legacy lacks the screen. Leaving `legacyPath` out
  instead means "nobody has mapped it yet". diffui reports those differently, so do not use one to
  mean the other.
- No `newPath` means the rebuild has not built it. That is what the report's _not built_ count is
  for, not a failure.
- A state's `open` is the steps that reach it, per side (`{"legacy": [...], "new": [...]}`), since
  the two apps' buttons differ. A state with no opener for a side does not exist there, and the
  report shows it as not built. Each step is a selector to click, a comma-separated union of them,
  or `hover <selector>` to reveal a control that only appears on hover. Its `settled` is what the
  panel looks like when it is ready.
- `sides.new.branch` is the diffui branch this rebuild pushes as. Each attempt (`mantine`,
  `shadcn`) is its own branch, compared with legacy and never with the others.

## Reading what comes back

- **Coverage first.** _Not built_ and _unmapped_ are the work nobody has started, and no score shows
  them.
- **Scores are relative.** diffui has no masks yet, so timestamps and ids put a floor under every
  score: 40% → 12% is progress, and 12% does not mean "12% wrong".
- **The review, not the score, ranks the work.** A missing control can score under 1%. Read
  `missing` and `text-changed` findings before chasing the biggest number.
- **Many screens differing the same way is one bug.** It is a theme default, a font, or an overlay.
  Stop fixing pages and find it.
- **`report --fail-over <percent>`** exits 2 when any screen is further off, for CI. It gates on
  pixels only, never on the review.

## Red flags

- A score you are about to celebrate on a screen `check.mjs` never saw.
- Several screens with the same file size: a redirect photographed as the dashboard.
- Every screen on one side shifted by the same amount: the two accounts differ.
- A phone capture showing the desktop navigation: touch emulation was off.
- Changing a user-visible string or a test-id to make a score move. The string **is** the finding;
  tell the user.

Read `references/traps.md` before the first shoot. Every trap in it cost somebody an afternoon.

## Needs

- The `diffui` CLI, signed in (`diffui whoami`). Set `DIFFUI_BIN` if it is not on `PATH`, e.g.
  `DIFFUI_BIN="bun ../diffui/packages/cli/src/index.ts"`.
- Playwright in this repo: `npm i -D playwright && npx playwright install chromium`.
- `diffui review` needs an AI gateway on the diffui server. Without one it says so, and everything
  else still works.
