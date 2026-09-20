---
type: milestone
title: Legacy baselines land
description: An engineer pushes legacy screenshots from the CLI and sees them against the routes they belong to.
status: built
entities: [shot, route]
tags: [okf]
---

# Legacy baselines land

Nothing can be compared until there is something to compare against. This
milestone is the capture side: the CLI pushes legacy screenshots, and each one
lands against a declared route, state and viewport.

The upload is [three steps, never one](../decisions/images-never-pass-through-the-api.md)
— ask for a URL, `PUT` the bytes at storage, register the row. Hundreds of PNGs
a run do not belong in the API's heap.

One legacy shot per route, state and viewport is
[pinned as the baseline](../entities/shot.md). Legacy still runs and can be
recaptured, so which shot everyone is measured against has to be a decision
rather than "the newest one".

The claim a shot makes is checked: a shot names a route, a state and a viewport
that were **declared**, or it is refused. A capture script inventing
`dialog-open-maybe` is how a report fills with typos nobody can tell from
screens.

```gherkin
Given 'maya' has declared a route with a state on it
When 'maya' pushes a legacy screenshot for that route at desktop
Then 'maya' sees that screenshot against the route
And 'maya' sees it marked as the baseline
And 'maya' is refused when she pushes a screenshot for a state she never declared
```
