---
type: decision
title: An organisation sees only its own projects
description: Every read and write is scoped to the caller's organisation, enforced on the function.
tags: [okf, security]
---

# An organisation sees only its own projects

A project belongs to an organisation. Someone in another organisation cannot
read it, cannot push a shot to it, and cannot tell that it exists.

## Where that is enforced

In the function's `permissions` field — never in a screen, and never by the
CLI. The CLI is a client like any other: it holds a session and calls the same
RPCs the browser calls. A rule the CLI enforces is not a rule.

This matters more here than in an app with only a browser, because there are two
clients and it is tempting to trust the one you wrote.

## How it is proven

Two engineers in two organisations, and a refusal scenario: one pushes a shot to
their own project, the other is refused when reaching for it. That refusal rides
along with the milestone that creates projects — not a "permissions" milestone
at the end — because a milestone that creates a row and does not say who may not
see it is not finished.

That is also why there are two engineer personas rather than one. "You see
yours, not theirs" cannot be tested with a single person.
