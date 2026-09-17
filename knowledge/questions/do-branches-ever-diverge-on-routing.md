---
type: note
title: Do branches ever diverge on routing?
description: Today every branch shares the route's new_path. If one diverges, that assumption breaks.
tags: [okf]
---

# Do branches ever diverge on routing?

A [route](../entities/route.md) carries one `new_path` shared by every branch,
on the assumption that branches are the same application built with different
component libraries — same screens, same URLs.

If a branch ever restructures its routing, that assumption fails and each branch
needs its own path per route.

Deliberately not built yet. The retrofit is cheap — a table of
`(branch, route) → path`, absent meaning "shares the route's path" — and it
invalidates nothing already captured, unlike masks. So the cost of being wrong
here is low and the cost of guessing early is a table nobody needed.

Coverage is derived from **shots**, not from path columns, so it already works
per branch whatever the answer turns out to be.
