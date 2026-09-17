---
type: note
title: Prune old diff images
description: Diff images are regenerable and will dominate storage before baselines do.
tags: [okf]
---

# Prune old diff images

Every capture run writes a diff image per route × state × viewport × branch.
They are **regenerable** — both source shots are kept — so they are the first
thing that should age out.

The `diffs` bucket is already separate from `shots` for exactly this reason
([why](../decisions/images-never-pass-through-the-api.md)), so the retention
policy has somewhere to attach when someone wants one. Nobody has asked yet.
