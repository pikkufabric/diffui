---
type: entity
title: Project
description: One legacy app, and every rebuild chasing it.
tags: [okf]
---

# Project

A project is **one legacy application and the rebuilds replacing it**. It owns
everything else: the routes, the viewports, the branches, every shot.

It belongs to an organisation. Two organisations may both have a project called
`bb2` and they are different projects that never see each other.

## Legacy is not a branch

A project has exactly **one** legacy side and **any number of branches**. That
asymmetry is the whole design, not an implementation detail:

- **Legacy** is the thing being replaced. It is the baseline every score is
  measured against.
- **A branch** is one attempt at replacing it — `mantine`, `shadcn`, a second
  go at the same screens with a different component library.

Branches are compared against legacy and **never against each other**. You can
still answer "which library gets closer", because both branches are scored
against the same baseline and you compare the *scores* — but no two branches'
pixels ever meet. See [comparing rebuilds](../decisions/legacy-is-the-only-baseline.md).

## Labels

`baseline_label` and `target_label` default to "legacy" and "new" and exist so a
team that calls them something else ("v1" and "v2", "prod" and "next") reads
their own words back. They change what the screens say, nothing else.
