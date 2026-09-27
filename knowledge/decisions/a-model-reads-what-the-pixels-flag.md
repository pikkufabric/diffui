---
type: decision
title: A model reads what the pixels flag
description: A vision model says what differs on each flagged screen. It sits beside the pixel score and never changes it.
tags: [okf]
---

# A model reads what the pixels flag

The pixel score says THAT a screen differs, never WHAT
([the diff is pixels only](the-diff-is-pixels-only.md)). A missing button in a
dense table scores under 1%, and a changed timestamp can outrank it. So on
request, a vision model looks at the legacy screenshot, the rebuild, the diff
and a close-up of each region, and lists what differs: missing, added, changed
text, layout, style, or noise from the data. Each finding has a severity, and
the review ends in a verdict of `matches`, `cosmetic` or `functional`.

## What it does not change

**The pixel score stays the measure.** The review is stored beside the
comparison (`comparison_review`) and never alters its numbers, its status or the
report's order. A pixel score is deterministic and can be checked by hand; a
model's answer is neither. A second opinion that can disagree with itself
between runs must not be able to move a score, and `report --fail-over` gates on
pixels only.

## When it runs

Only when asked: `diffui review`, or `diffui push --review`. It covers only
`different` comparisons (identical ones have nothing to explain, and size
mismatches were never compared), and only the latest capture of each screen
against the current baseline. The worst screens come first, capped at 25 per
request by default. A review is kept per comparison, so re-pushing an unchanged
image never pays for a second one. A new model or prompt version marks older
reviews stale.

It runs as the `reviewRebuild` workflow: one step finds the screens, then one
step per screen, so a restart replays finished reviews instead of paying for
them again. A screen the model could not review is recorded as `failed` rather
than failing the run, and the next request retries it.

## What it costs, and where the images go

**Screenshots leave diffui.** The call goes through the `agentRunner` the
runtime injects: Fabric's LiteLLM gateway on a stage, or
`OPENAI_BASE_URL`/`OPENAI_API_KEY` under `pikku dev`. From there it reaches the
model vendor. A stage with no gateway has no reviews, and says so. There is no
per-organisation switch yet. Until there is, whether a stage can review is
whether it has a gateway.

Each review is one call to a large vision model with up to seven images, so it
costs roughly a few cents a screen. That is why it is opt-in and capped rather
than automatic on every push.

## What this rules out

Ranking or failing a build on the model's verdict. The verdict tells a person
where to look first. It is not a score, and nothing gates on it.
