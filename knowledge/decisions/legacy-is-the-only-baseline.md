---
type: decision
title: Legacy is the only baseline
description: Branches are scored against legacy and never against each other.
tags: [okf]
---

# Legacy is the only baseline

A project has one legacy side and N branches. **Every comparison is a legacy
baseline against one branch shot.** No comparison ever has two branch shots in
it.

## Why not compare branches directly

Because the question is "how close is this rebuild to the thing it replaces",
and legacy is the only answer to that. Two branches diffed against each other
measures how similar two rebuilds are, which nobody asked.

The interesting question — *does Mantine get closer than shadcn* — is still
answerable, and better answered this way: both are scored against the same
baseline and you compare the **scores**. That is a comparison of two measurements
against a fixed reference, rather than a measurement between two moving things.

## What makes the scores comparable

Only identical capture conditions. Two branches scored against different
baselines, or at different viewports, produce numbers that can be ranked and
should not be. So:

- the baseline is **pinned** (`is_baseline`), not "the newest legacy shot"
- viewports are **declared rows** on the project, and a shot references one by
  foreign key rather than carrying a free-text size

## What this rules out

Diffing two branches to see what changed between rebuild attempts. If that is
ever wanted it is a different feature with a different meaning, and it should
not quietly reuse `comparison`.
