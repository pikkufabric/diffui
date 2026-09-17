---
type: milestone
title: A rebuild is scored against legacy
description: An engineer pushes a branch screenshot and sees how far it is from the legacy baseline.
status: proposed
entities: [shot, project]
tags: [okf]
---

# A rebuild is scored against legacy

The point of the tool. A branch — one rebuild — pushes its screenshot for a
route, and it is compared against the pinned legacy baseline for the same route,
state and viewport.

[Legacy is the only baseline](../decisions/legacy-is-the-only-baseline.md): the
comparison is always legacy against one branch, and two branches never meet.

The score is [auditable](../entities/shot.md) — the differing pixel count and
the total are both kept, so the percentage can be checked rather than trusted.
When the two images are not the same size the comparison says `size-mismatch`
and **no number is invented**, because resizing to force a score produces a
figure made partly of interpolation.

Scores carry a [noise floor](../decisions/no-masks-in-v1.md) until masks exist,
so they are read as relative.

```gherkin
Given 'maya' has a pinned legacy baseline for a route at desktop
When 'maya' pushes a screenshot for her mantine branch at desktop
Then 'maya' sees how far that branch is from legacy on that route
And 'maya' sees the differing pixel count and the total it was taken over
And 'maya' sees a comparison of mismatched sizes reported rather than scored
```
