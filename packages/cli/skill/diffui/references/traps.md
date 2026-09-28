# Traps

Every one of these cost real time on a real migration. Roughly in order of how much.

Some traps from hand-rolled parity work are gone because diffui does that part: it computes the
difference itself, at capture resolution, on the server. Do not compute a difference in the
browser, resample before scoring, or build your own page of screenshots. What is left is getting
honest captures in, and reading what comes back.

---

## Discovering

### Read-only blocks reads that use POST

Read-only discovery blocks every request that is not a GET. An app that reads with POST (GraphQL,
RPC endpoints, every Pikku app) then renders empty tables. Empty tables have no rows to click and
no links to the detail pages, so discovery silently finds a fraction of the app. The run lists every
blocked request. Read the list: anything that is a read goes in `sides.<side>.readOnly.allow`, then
run again. In testing, one allowed URL took a rebuild from 5 screens and 4 panels to 6 and 6.

### Hover-only controls live in data rows

A row menu revealed on hover is found by hovering the first row **with data cells**. Browsers
insert a `<tbody>` even when the markup has none, so the naive "first row" is the header, which
reveals nothing and reads as "no row menu". If a table's rows are not `tr` or `[role=row]`,
discovery will not see the control. Add the state by hand.

### Discovery signs itself out if you let it

A crawler that follows every link follows "Log out", and every screen after it is the login page.
"Log out", "Sign out" and logout links are never touched. An app with another way out ("Switch
account", "Leave workspace") needs it in `discover.skip`. When the crawl lands on the login page it
stops and says so rather than cataloguing the login page forty times.

### The same screen with no words in common

Pairing matches on what a person reads, so a renamed screen ("Dashboard" → "Home") comes out as
one legacy-only and one rebuild-only screen. It never guesses below its bar, because a wrong pair
is worse than none: it compares two unrelated pages and reports a big number. Merge them by hand
in review.

## Capturing

### The redirect trap

Signed in, `/`, `/login` and `/register` all redirect to the dashboard, so three screens come back
as three photographs of the dashboard. They score like anything else, and nobody notices until
someone opens them. `shoot.mjs` records the URL the browser landed on, and `check.mjs` refuses the
push when it differs from the one asked for. Shoot public screens in a second, **signed-out** pass
(a second config with `auth.kind: "none"`). Treat identical files across unrelated screens as the
alarm it is.

### The provenance trap

A stale capture under the right filename looks exactly like a pass. It is the one failure a score
cannot show you. Run `check.mjs --since <rebuild src>`: it refuses rebuild shots older than the
newest source change. That catches the re-shoot that silently never ran.

### The entitlement trap

The account shifts every coordinate on every page. One shoot ran as a user with no licence, so a
banner sat above the content and every y on the legacy side was 44px low against a rebuild shot as
a licensed user. Every screen scored "different", and every one for the same reason. Use accounts in
the same state on both sides, and tell the user which accounts they were.

### Touch emulation

A phone-width capture with touch emulation off renders the desktop navigation on any layout that
keys off pointer type rather than width, and you compare two desktop screens believing they are
phones. `shoot.mjs` turns it on below 700px. Phone captures also run two to three times taller than
desktop, so they are where time and memory bite first.

### Capture timing

You only discover this when you parallelise. A blind sleep after navigation works with one browser
and produces twenty "no opener matched" failures with four workers on one dev server. Those
failures look exactly like missing components. Wait for the **screen**: loader detached, network
idle, then a short settle (`SETTLE_MS`, default 700). Remote images decode _after_ the loader
disappears. Shot too early, a photo grid comes back white on one side and reads as a styling bug.

### Cold compile at login

Restart the dev server before a shoot and the first request compiles the login route, which can
outrun Playwright's timeout. Sign-in dies, and every later capture fails unauthenticated with an
error that says nothing about login. `shoot.mjs` warms the login page up first with a long timeout.
If sign-in still fails, load the page once by hand.

### Controls hidden by visibility

A row menu held at `visibility: hidden` until the row is hovered cannot be reached by
`locator.click`. `shoot.mjs` reads the box and drives the mouse to it. Give it the control's own
selector, not its row's.

### Dialogs and menus are screens

A route list misses exactly the screens where a rebuild diverges most: dialogs, menus, row
actions, empty states, error states. Nobody screenshots them. Declare each as a **state** of its
screen, with the clicks that open it (`open`) and what it looks like when ready (`settled`). diffui
then scores it like any other screen.

### Sharding

Stride the work **round-robin**, not in blocks. Slow captures cluster (a table's sort, menu and
dialog states sit together), so a block split hands one worker all of them. Round-robin took one
full shoot from about 20 minutes to 4.5 on four workers. The shared dev server is the bottleneck,
not the browsers. Past about four workers you are only adding failures.

### The id trap

Legacy ids never map to rebuild ids. Pair at **screen-type** level (`orders.detail`), using a
record that exists on both sides, and read the rebuild's own slug off its index rather than
assuming the number carries over.

---

## Reading the result

### There is a noise floor

diffui has no masks yet, so a timestamp, a generated id or sample data puts a floor under every
score. Read scores as **relative**: 40% → 12% is progress, and 12% does not mean "12% wrong". A
model review names that noise (`noise`, always low severity), so check the review before chasing a
number.

### The score says THAT; the review says WHAT

A missing button in a dense table scores under 1%. In one real test, a page scoring 1.22% was
missing its Export button. Never rank work by score alone. Run `diffui review` on a rebuild's
flagged screens and read the `missing` and `text-changed` findings first.

### The defaults trap

When many screens differ in the same way, stop fixing screens. It is almost never the pages: it is
a handful of component-library defaults repeated thousands of times, and per-page compensation
cannot converge. A nudge fixes one screen and buries the evidence on eighty. Real ones, all fixed
centrally in the theme:

- `lineHeights.md` at 1.55 where legacy was 1.5: every 14px line came out 21.7px against 21, on
  about 120 elements per page.
- Table spacing defaults (8/16px) against legacy's `0 12px` / `8px 12px`. And legacy rules the
  **cell** where the library rules the **row**, so setting the cell border without zeroing the row
  gives a doubled rule.
- A modal overlay at 60% black against legacy's 32%. Three screens came out 68–79% different with
  every element in the right place: the whole page was just darker.

### The font ladder trap

Legacy may ship **one** font file and put its other weights in separate families, each declared
normal. There, `font-weight: 300` and `500` both render Regular. If the rebuild loads the full
weight ladder, every glyph advance differs, every line is subtly off, and the CSS is already right:
it is a font-_loading_ decision. Diagnose with `canvas.measureText` on one string at several
weights. Identical widths on legacy are the tell. Fix it where the font URL is chosen, not in a
stylesheet.

### A tall page is a product finding

When the rebuild is much taller than legacy (3,365px → 24,959px was one real case), diffui aligns the
rows and reports the extra as `added` regions. That is almost never styling: the rebuild renders the
whole collection where legacy paginated. Report it to the user as a product difference. No CSS
closes it.

### Data is not styling

Two accounts, two tenants or two catalogues differ, and so do their screens. A difference caused by
data must be called that, not fixed as a style defect.

---

## Fixing

### Port from the source, not from the screenshot

A screenshot shows one width. Legacy's stylesheets show all of them: the breakpoints, the container
widths, the type scale, the `rem` base. Port the system, and parity then holds at widths nobody
captured.

### Specificity and inline props

`.chrome h1` is specificity (0,1,1) and beats any single-class rule. `:is()` does not help and
`:where()` does, because it zeroes the element part. Component-library inline props (`fz=`, `fw=`)
become inline styles no stylesheet can beat. Those move into the theme.

### Parity work versus the test suite

Rewriting markup for parity breaks every test asserting on a test-id or on copy. The rule that
holds: **parity work may change CSS and component props freely, but not test-ids or user-visible
strings.** Where a legacy string genuinely differs, the string _is_ the finding. Tell the user;
don't silently change the markup. Re-run the suite after each batch regardless.

### Parallel agents

Split the work by page-scoped stylesheet, lock any shared message file, and typecheck without an
incremental cache (`tsc --noEmit --incremental false`), because a shared one corrupts under
concurrent writers. The real collision risk is **class names** across agents working on different
pages, not the files.
