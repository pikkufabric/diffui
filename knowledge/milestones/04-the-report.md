---
type: milestone
title: The report
description: An engineer sees how far each rebuild is, and what nobody has built, without confusing the two.
status: built
entities: [project, route]
tags: [okf]
---

# The report

What the whole thing is for: an engineer opens a project and can answer, in one
screen, how the rebuild is going.

Two questions, [kept apart](../decisions/design/the-report-answers-two-questions.md):

- **How far off** — the score per route, per branch, per viewport, worst first.
  That ordering is the work queue.
- **What is missing** — routes legacy has that this branch has no shot for. A
  route with nothing built has **no score**, and must never be rendered as one.

Three-up viewing when a number is not enough: legacy, the branch, and the diff
overlay side by side. A percentage tells you a screen is wrong; only the images
tell you how.

A branch-level score always carries the count it was taken over, because a mean
over twelve routes and a mean over ninety are not comparable and the difference
is invisible in the number itself.

```gherkin
Given 'maya' has scored two branches against legacy across several routes
When 'maya' opens the report for her project
Then 'maya' sees each route scored per branch with the worst first
And 'maya' sees how many routes each branch score was taken over
And 'maya' sees routes nobody has built listed as gaps rather than as scores
And 'maya' can open one route and see legacy beside the branch and the difference
```
