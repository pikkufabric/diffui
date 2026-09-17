---
type: decision
title: Images never pass through the API
description: The CLI uploads straight to storage with a presigned URL, then registers the shot.
tags: [okf]
---

# Images never pass through the API

Uploading a shot is **three steps, not one**:

1. the CLI asks the API for an upload URL
2. the CLI `PUT`s the PNG **directly at storage**
3. the CLI registers the shot row, naming the key it just wrote

## Why not just post the file

Because a capture run is hundreds of PNGs. Routes × states × three viewports ×
branches gets into the high hundreds for a real app, and every one of those
crossing the API process is heap it does not need to touch, for no gain — the
API has nothing to say about the bytes.

## What carries it

`ContentService` from `@pikku/core`, which is bucket-typed and already knows how
to do this: `getUploadURL` hands out a short-lived path-bound signature, and the
local implementation's request handler verifies it before writing. Locally that
is `LocalContent` writing to disk; hosted, the same call sites reach S3 without
changing.

Two buckets, because they have different lifetimes:

- `shots` — captures, including the pinned baselines. Long-lived.
- `diffs` — generated diff images. Regenerable, and the first thing to prune.

## What this rules out

Any API endpoint that accepts image bytes. If one appears, a capture run will
eventually be routed through it and the reason it was avoided will have been
forgotten.
