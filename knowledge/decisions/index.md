---
type: Overview
title: Decisions
description: What was chosen, and what it rules out.
tags: [okf]
---

# Decisions

- [Legacy is the only baseline](legacy-is-the-only-baseline.md) — branches are never compared to each other
- [The diff is pixels only](the-diff-is-pixels-only.md) — no DOM or semantic comparison
- [Pages are aligned before they are compared](pages-are-aligned-before-they-are-compared.md) — a different height is aligned, a different width refused
- [No masks in v1](no-masks-in-v1.md) — and what that costs until they arrive
- [Images never pass through the API](images-never-pass-through-the-api.md) — direct upload
- [One app, orgs for tenancy](one-app-orgs-for-tenancy.md)

Sub-sections:

- [security/](security/index.md) — who may reach what
- [design/](design/index.md) — how it looks and behaves

<!-- pikku:knowledge-index -->
- [design](design/index.md) — a rule about how the app looks and behaves
- [security](security/index.md) — a rule about who may do what
- [A browser step waits for hydration](a-browser-step-waits-for-hydration.md) — Steps that act on the page wait for React to attach, because a click on server-rendered HTML succeeds and does nothing
- [Images never pass through the API](images-never-pass-through-the-api.md) — The CLI uploads straight to storage with a presigned URL, then registers the shot.
- [Legacy is the only baseline](legacy-is-the-only-baseline.md) — Branches are scored against legacy and never against each other.
- [No masks in v1](no-masks-in-v1.md) — Captures are unmasked, so every score carries a noise floor. Legacy still runs, so this is reversible.
- [One app, organisations for tenancy](one-app-orgs-for-tenancy.md) — Everyone who signs in shares one frontend; an organisation owns its projects.
- [Pages are aligned before they are compared](pages-are-aligned-before-they-are-compared.md) — Screenshots of different heights are aligned row by row, like a text diff, instead of being rejected. Only a different width is refused.
- [The diff is pixels only](the-diff-is-pixels-only.md) — No DOM, ARIA or semantic comparison — and what the percentage therefore cannot tell you.
<!-- /pikku:knowledge-index -->
