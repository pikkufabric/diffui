---
type: entity
title: Shot
description: One captured image, and the declared thing it is a picture of.
tags: [okf]
---

# Shot

A shot is **one PNG and the claim of what it shows**: this route, in this state,
at this viewport, on this side.

Every part of that claim is a foreign key — route, state, viewport, branch. A
client cannot upload a screenshot of a state nobody declared, or at a resolution
nobody declared. That is deliberate: the alternative is free-text keys drifting
in from capture scripts until the report is full of `dialog-open-maybe` and
nobody can tell a typo from a screen.

A shot with no state is the route's **base state**, which keeps the common case
free of ceremony.

## Which legacy shot everyone is measured against

Legacy still runs, so it can be recaptured — someone patches the old app, or the
seeded data changes. That makes "compare against the newest legacy shot" wrong:
every branch's score would move because the *baseline* moved, and nobody could
tell that from their own work regressing.

So one legacy shot per route/state/viewport is marked `is_baseline`, and that is
the one every branch is scored against until somebody deliberately re-pins it.

## The percentage is auditable

A comparison stores `diff_pixels` **and** `compared_pixels`, not just the
percentage derived from them. A number you cannot check is a number you have to
trust, and the denominator is exactly where a diff tool quietly lies — by
resizing, by padding, by comparing an intersection and not saying so.

Nothing is ever resized. Two images of different **widths** are recorded as
`size-mismatch` and **no score is invented** — resizing to force a comparison
would produce a number made partly of interpolation, which looks like a measure
and is not one. Two images of different **heights** are
[aligned row by row](../decisions/pages-are-aligned-before-they-are-compared.md)
and compared where they line up; `compared_pixels` then counts the aligned rows,
so the denominator still says exactly what the number was taken over.
