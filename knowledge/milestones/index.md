---
type: Overview
title: Milestones
description: The buildable pieces, in dependency order.
tags: [okf]
---

# Milestones

Each is one vertical piece — migration, functions, screen, scenario — ending in
something an engineer can do in a browser.

1. [A project and its routes](01-a-project-and-its-routes.md) — the spine, and org isolation
2. [Legacy baselines land](02-legacy-baselines-land.md) — capture, upload, pinning
3. [A rebuild is scored against legacy](03-a-rebuild-is-scored.md) — the point of the tool
4. [The report](04-the-report.md) — how far off, and what is missing

The order is dependency, not preference: there is nowhere to put a shot until a
route exists, nothing to compare against until legacy lands, and nothing to
report until something has been scored.

<!-- pikku:knowledge-index -->
- [A project and its routes](01-a-project-and-its-routes.md) — An engineer creates a project and declares the screens it tracks, and sees which of them legacy has.
- [Legacy baselines land](02-legacy-baselines-land.md) — An engineer pushes legacy screenshots from the CLI and sees them against the routes they belong to.
- [A rebuild is scored against legacy](03-a-rebuild-is-scored.md) — An engineer pushes a branch screenshot and sees how far it is from the legacy baseline.
- [The report](04-the-report.md) — An engineer sees how far each rebuild is, and what nobody has built, without confusing the two.
<!-- /pikku:knowledge-index -->
