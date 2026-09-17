---
type: entity
title: Route
description: A screen, identified by name rather than by URL, with a path on each side.
tags: [okf]
---

# Route

A route is **one screen**, and its identity is a **name** — `company.add-user` —
not a URL.

That is the load-bearing decision. A legacy Angular app addresses a screen as
`/#/product-library/:id/summary` and the React rebuild addresses the same screen
as `/app/products/$productId`. They share no string. If the identity were the URL
the two sides could never be paired, so the route carries a name of its own and
**both paths hang off it**:

- `legacy_path` — where to find it in the legacy app
- `new_path` — where to find it in a rebuild

## The two nulls mean different things

This is the part that is easy to get wrong and expensive to get wrong, because
it is the whole coverage report:

| `legacy_path` | `legacy_absent` | means |
| --- | --- | --- |
| set | 0 | legacy has this screen |
| NULL | 0 | **nobody has mapped it yet** — an unanswered question |
| NULL | 1 | **legacy genuinely does not have it** — a stated fact |

"We haven't looked" and "it isn't there" are different claims, and a report that
conflates them tells you a rebuild is complete when nobody has checked. A route
with `new_path` NULL is the other direction: legacy has a screen the rebuild has
not built.

## States

A route has any number of [states](shot.md) — a dialog open, a tab selected, a
validation error showing. A state is a named state *of a route*; if it has a URL
of its own it is a route, not a state.

A state carries a `ref` — a scenario name, a spec file, a ticket — which is
free text and deliberately never validated. Validating it would mean picking a
test framework, and diffui does not know or care which one the consuming repo
uses.
