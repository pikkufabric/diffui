---
type: decision
title: One app, organisations for tenancy
description: Everyone who signs in shares one frontend; an organisation owns its projects.
tags: [okf]
---

# One app, organisations for tenancy

There is **one frontend**. Everyone who signs in is on the same side of the
counter: engineers working on a rebuild, reading the same reports and pushing
from the same CLI. There is no customer-facing audience, so there is no second
app.

## Organisations, not roles, carry tenancy

diffui is meant to be hosted as a service later, so a project belongs to an
**organisation** and never to a user. Two teams may both have a project called
`bb2`, and neither can see the other's.

Organisation membership comes from Better Auth's organisation plugin — which
also brings its own owner/admin/member roles for invitations. Those are not
re-declared as system roles here; inventing a parallel set would give two
answers to who may do what.

## The one system role

`engineer` — the person who sets up a project, declares its routes, pushes shots
and reads the report. That is the whole audience today.

A read-only viewer role is plausible and has not been asked for. Inventing it
now would mean inventing screens and rules that someone then has to live with,
so it is a [wish](../wishlist/a-read-only-viewer.md), not a role.

## What this rules out

Per-user projects. A project always has an organisation, from the first
migration, because retrofitting tenancy onto rows that were written without it
is the migration nobody wants.
