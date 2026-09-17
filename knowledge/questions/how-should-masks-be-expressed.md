---
type: note
title: How should masks be expressed?
description: Selectors or rectangles — deferred with v1, but the answer shapes the capture client.
tags: [okf]
---

# How should masks be expressed?

[Masks are deferred](../decisions/no-masks-in-v1.md). When they arrive there are
two shapes and they are not equivalent:

- **Selector-based, applied at capture time.** Playwright paints the element
  before saving. Survives layout changes, works at every viewport without
  rewriting anything. But the mask is baked into the stored PNG, so changing the
  mask list means recapturing.
- **Rectangles, applied at diff time.** The stored image stays untouched and
  masks can change retroactively. But coordinates break when a layout moves, and
  each viewport needs its own rectangle.

A third shape exists: resolve selectors to boxes at capture time, upload the
boxes with the shot, blank them at diff time. Selector robustness with the
original image kept — adding a new mask still needs a recapture, adjusting one
does not.

Not answered because it is not yet needed, and answering it early would commit
the capture client to a shape before anyone has felt the problem.
