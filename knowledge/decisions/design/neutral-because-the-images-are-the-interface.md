---
type: decision
title: Neutral, because the images are the interface
description: The shipped monochrome theme is kept deliberately — the screenshots carry the colour.
tags: [okf, design]
---

# Neutral, because the images are the interface

The app keeps the template's **Neutral** theme: a deliberately unopinionated
monochrome scaffold.

This is a choice, not a default left unexamined — the difference matters, because
"we kept Neutral" and "nobody thought about it" produce the same screens and
different projects.

## Why

Every screen in diffui is a frame around **someone else's screenshots**. A
three-up viewer puts a legacy capture, a rebuild capture and a diff overlay side
by side, and those images already carry two applications' worth of brand colour.
A chrome with opinions of its own competes with the thing it is displaying, and
the eye needs to be able to trust that a red region is in the diff and not in the
furniture.

The diff overlay in particular: `pixelmatch` paints differing pixels in a
signal colour, and that colour has to be unambiguous. A themed app full of the
same hue makes a diff harder to read, which is the one job here.

## What this rules out

Brand colour in the shell. Status colour stays available and meaningful —
a `size-mismatch` badge, a coverage gap — but the surface around an image stays
quiet.

It is an internal tool, and it looks like one. Said out loud rather than left to
be discovered.
