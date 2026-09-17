---
type: decision
title: No masks in v1
description: Captures are unmasked, so every score carries a noise floor. Legacy still runs, so this is reversible.
tags: [okf]
---

# No masks in v1

A **mask** is a region excluded from the comparison because you know it
legitimately differs — a timestamp, a generated id, a seeded random name, a
"showing 1–20 of 47" count. diffui has none.

## What that costs

Everything on that list registers as difference on every run. The effect is a
**permanent noise floor**: a screen that is visually identical sits at some
non-zero percentage forever, and the worst-diffs list over-promotes screens that
happen to show a lot of text.

So scores are **relative, not absolute**. A screen going 40% → 12% is real
progress. 12% is not "12% wrong".

Anyone reading the report needs to know this, which is why it is a note and not
a comment in a diff function.

## Why it is safe to defer

Because **legacy still runs**. Baselines can be recaptured whenever masks
arrive, so nothing captured now is a one-way door. Had legacy been switched off,
this decision would have had to be made before the first capture — masking is
the one thing that is expensive to retrofit, and only because of the baselines.

## When it is time

When someone stops trusting the ranking. The likely shape is selector-based
masks resolved at capture time — robust to layout changes and viewport-
independent, unlike rectangles, which need one per resolution and break the
moment anything moves.

Open question: [how masks should be expressed](../questions/how-should-masks-be-expressed.md).
