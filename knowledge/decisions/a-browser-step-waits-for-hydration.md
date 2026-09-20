---
name: a-browser-step-waits-for-hydration
description: Steps that act on the page wait for React to attach, because a click on server-rendered HTML succeeds and does nothing
type: decision
---

# A browser step waits for hydration

Every scenario step that ACTS on the page — `clicks`, `fills` — waits for React
to have attached to it before doing anything. Steps that only READ it do not.

## Why

The app is server-rendered. `opensPage` returns as soon as the HTML is on
screen, and the client bundle attaches its handlers roughly a second later. In
that window every control is present, visible and actionable, so Playwright
clicks it, reports success, and **nothing happens**: no console error, no failed
request, no navigation, no row written. The failure surfaces later, somewhere
else, as an assertion that times out for no visible reason.

That cost most of a day on `mayaDeclaresARouteScenario`. The form filled, the
click reported ✓, and the project was never created. Everything that looked like
a cause — validators, native form submit, the trailing `?` on the URL, the
mutation, tenancy — was investigated and innocent. The page was even proven to
hydrate, which made it look MORE mysterious rather than less: hydration happened
about a second AFTER the click had already been thrown away.

What finally settled it was asking the page directly, from inside the browser,
whether the button carried React's own fibre property at the moment of the
click. It did not: `nodesWithFiber: 0`.

## How to apply

`interactive()` in `test/lib/browser-vocabulary.ts` is the readiness check, and
it waits for React's own fibre property on a real control.

It is deliberately NOT a sleep — a sleep is a guess that gets longer every time
it flakes — and deliberately NOT a marker the app renders for tests, which would
put a test's needs inside a component. `networkidle` is not enough either: the
HTML goes idle long before the bundle has hydrated it.

Any new step that acts on the page must call it too. A step that forgets will
not fail; it will pass while doing nothing, which is the whole problem.
