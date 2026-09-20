---
name: how-should-ci-authenticate
description: A CI runner has no browser to approve a device code, so it cannot run diffui login as written
type: question
---

# How should CI authenticate?

`diffui login` runs the device authorization flow: it prints a code and waits
for a person to approve it in a browser. A CI runner has neither a browser nor a
person, so it cannot log in this way.

What CI needs is a key it was handed in advance, which is exactly what `login`
already ends up holding — the flow trades its session for an API key and stores
that. So the missing piece is small: let the CLI read a key from the environment
(`DIFFUI_API_KEY`) instead of from `~/.diffui/session.json`, and give someone a
way to mint one for a pipeline without logging in on the pipeline's behalf.

## What is actually open

- **Who owns a CI key.** The skill's model is a small set of stable service
  users owning keys, not a key per pipeline owned by whoever happened to create
  it. An engineer's key stops working when they leave; a pipeline's should not.
- **What a CI key may do.** `mapKey` can return an authoritative `scopes` set,
  so a push-only key that cannot delete a project is expressible. Nobody has
  decided whether it should be.
- **Rotation.** Keys are minted with a 90-day expiry and nothing warns before
  one lapses. A push failing at 3am with "Authentication required" is the worst
  possible way to learn this.

Not urgent: today's job is for an engineer at a terminal. It becomes urgent the
first time someone wires diffui into a pipeline.
