---
type: decision
title: Pages are aligned before they are compared
description: Screenshots of different heights are aligned row by row, like a text diff, instead of being rejected. Only a different width is refused.
tags: [okf]
resource: table:comparison
---

# Pages are aligned before they are compared

Two screenshots of the same width are compared even when their heights differ.
Their rows are **aligned first** — the way a text diff aligns lines — and only
rows that line up are compared pixel for pixel. A screenshot of a different
**width** is still `size-mismatch` and never scored.

## Why

A full-page capture of a rebuild is almost never exactly as tall as legacy. One
card a few pixels taller pushes every section below it down, and a top-aligned
comparison then scores the rest of the page as different — or, as v1 did, the
two are rejected as `size-mismatch` and nothing is scored at all. A team
running parity on a real app (applause-fabric) found a plain pixel diff useless
for exactly this reason: pages differed in height by a thousand pixels or more,
and everything shifted. The same thing happens inside a fixed-size viewport
capture, where a taller header pushes content down and off the bottom.

Width is different. A different width is a different viewport, and the honest
answer to "how close is a capture at the wrong viewport" is that it was captured
wrong. That stays a refusal.

## How it works

1. **Fingerprint every row** of both images (coarse — the low bits of each
   channel are dropped, so a shade of anti-aliasing does not break a match).
2. **Strip the common head and tail**, then run a **Myers diff** over the
   fingerprints of what is left: the same algorithm, and the same guarantee of
   a minimal edit, as a line diff.
3. **Pair rows inside each hunk top-down**, so a section the rebuild restyled is
   compared against legacy's version of it rather than written off; the rows one
   side has more of are left unpaired.
4. **Also score the plain top-aligned pairing**, and report whichever explains
   the two pages with fewer differing pixels. Alignment is ambiguous where rows
   repeat — whitespace, flat backgrounds — and can explain an in-place edit as
   rows removed in one place and added in another. Scoring both means an edit in
   place is scored in place and a moved section is scored as moved.
5. **pixelmatch** compares every paired row. A row only one side has costs its
   **content** — each pixel that stands out from that page's background — so an
   inserted card costs the card, not a full-width stripe of mostly empty page.
   A page that only grew empty space costs nothing, but is still `different`,
   with the space reported as a region. On a tie between the two pairings, the
   one that leaves fewer rows unpaired wins, so an edit in place stays in place.

The search is bounded (`maxEdits`, default 1,500 inserted plus deleted rows);
past it the pages share too little structure for an alignment to mean anything,
and the middle is compared top-aligned.

## What it reports

The score stays [auditable](../entities/shot.md): `compared_pixels` is width ×
aligned rows, and `diff_ratio` is exactly `diff_pixels / compared_pixels`.

Alongside it, **regions** — the stretches of rows that changed, that only legacy
has, or that only the rebuild has — each with its y-range on **both** images,
because the two pages scroll apart once one of them grows. A region is read off
the pixels actually found, not off the alignment, so rows that fingerprint
differently but look the same report nothing; neighbouring regions of the same
kind are merged so a changed card is one region rather than one per line of
text. The route screen lists them, and the diff image paints them: red for
changed pixels, orange for rows only legacy has, green for rows only the
rebuild has.

## What it rules out

- **Moves are not detected as moves.** A section that moved to another part of
  the page is one region removed and one added, exactly as a text diff reports
  a moved paragraph.
- **No horizontal alignment.** A sidebar that got wider shifts every row's
  content sideways, and no row pairing fixes that. The pixels in those rows are
  still compared, and still read as different.
- It is still [pixels only](the-diff-is-pixels-only.md): a region says *where*
  the pages differ, never *what* the difference is.
