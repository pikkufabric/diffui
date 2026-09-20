---
type: milestone
title: A project and its routes
description: An engineer creates a project and declares the screens it tracks, and sees which of them legacy has.
status: built
entities: [project, route]
tags: [okf]
---

# A project and its routes

The spine. Without a project there is nowhere to put a screenshot, and without
routes there is nothing to take a screenshot *of*.

An engineer creates a project for the app they are rebuilding, declares its
routes — each a name with a legacy path and a new path — and sees them listed
with what is known about each. The three [coverage
states](../entities/route.md) are visible from the first screen: legacy has it,
legacy does not have it, nobody has said.

Creating a project seeds its three [viewports](../entities/project.md) —
desktop, tablet, mobile — because a project with no declared resolution cannot
accept a shot, and asking the engineer to invent three before they can do
anything is ceremony.

The refusal belongs here, with the milestone that creates the thing being
refused: a project belongs to an organisation, and
[nobody else can reach it](../decisions/security/an-organisation-sees-only-its-own-projects.md).

```gherkin
Given 'maya' has created a project for the app she is rebuilding
When 'maya' declares a route named company.add-user with a path on each side
Then 'maya' sees that route listed against her project
And 'maya' sees a route legacy does not have marked as absent rather than missing
And 'rafi' cannot reach 'maya' project
```
