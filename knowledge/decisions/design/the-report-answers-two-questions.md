---
type: decision
title: The report answers two questions, separately
description: How far off, and what is missing — never merged into one number.
tags: [okf, design]
---

# The report answers two questions, separately

The report has two jobs and must not blur them:

- **How far off is this rebuild?** — the pixel score per route, per viewport.
- **What has nobody built?** — routes legacy has that this branch has no shot
  for.

## Why they stay apart

Because [the diff is pixels only](../the-diff-is-pixels-only.md), a score cannot
answer the second question. A screen nobody has built has **no score at all** —
not 100%, not zero. Rendering it as a number would put "not built" on the same
axis as "slightly off", and the two demand completely different responses.

So a route with no shot reads as a gap, in its own column, and never as a
percentage.

## Averages need their denominator

A branch at 8% across 12 routes is not beating one at 11% across 90. Wherever a
branch-level score appears, the count it was taken over appears beside it — a
mean with a hidden denominator is the easiest way for this tool to mislead the
person who built it.

## Coverage has three states, not two

From [Route](../../entities/route.md): legacy has it and we have not built it;
legacy genuinely does not have it; nobody has mapped it yet. The third is an
unanswered question rather than a gap, and a report that shows two states will
quietly convert unanswered into finished.
