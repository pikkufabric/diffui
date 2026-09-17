---
type: decision
title: The diff is pixels only
description: No DOM, ARIA or semantic comparison — and what the percentage therefore cannot tell you.
tags: [okf]
---

# The diff is pixels only

Comparison is `pixelmatch` over two PNGs. There is no DOM diff, no accessibility
tree diff, no text extraction.

## What that buys

It works on anything that can produce a PNG. The consuming repo can drive
Playwright, Cypress, a phone, or a person with a screenshot key, and diffui does
not need to understand the app it is looking at. A semantic diff would need to
parse both sides, and the legacy side is exactly the app nobody wants to touch.

## What it costs, and this matters

**A pixel score tells you THAT a screen differs and by how much. It never tells
you WHAT is missing.** A missing menu item in a dense table is well under 1% and
will never surface as the worst screen on the list.

So "what is left to build" is answered by **coverage**, not by the score:
a route where legacy has a path and a branch has no shot. Those are two separate
questions and the report must answer them separately rather than hoping a
percentage covers both.

## What this rules out

Ranking screens by "most broken" in any sense other than pixel area. A
text-dense screen with a date on it will outrank a screen missing a whole
control, and no amount of reading the percentage harder fixes that.
