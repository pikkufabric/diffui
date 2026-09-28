#!/usr/bin/env node
/**
 * Refuse to push captures that cannot be trusted.
 *
 *   node check.mjs --config shoot.json shots/legacy/manifest.json shots/new/manifest.json [--since apps/app/src]
 *
 * diffui scores whatever it is given. A stale shot under the right filename, or a
 * login redirect photographed as the dashboard, scores like any other screen and
 * reads as a real result — so this runs BEFORE `diffui push`, while a bad capture
 * is still a re-shoot and not a number someone has already acted on.
 *
 * Checks, roughly in the order they fire in practice:
 *   - a shot whose landed URL is not the one it asked for (a silent redirect:
 *     signed in, `/`, `/login` and `/register` all photograph the dashboard)
 *   - a rebuild shot older than the newest file under --since (a re-shoot that
 *     never ran)
 *   - two different screens that produced byte-identical files
 *   - a screen × state the config says this side has, missing at some viewport
 *     (how a mobile pass ends up half-shot)
 *
 * A screen the rebuild has not built is NOT a problem here: the config has no
 * `newPath` for it, nothing was shot, and diffui's report lists it as not built.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathFor, statesFor } from './lib.mjs'

const argv = process.argv.slice(2)
const flag = (name) => {
  const i = argv.indexOf(name)
  return i === -1 ? null : argv[i + 1]
}
const configPath = flag('--config')
const since = flag('--since')
const manifests = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'))
if (!configPath || manifests.length === 0) {
  console.error('usage: check.mjs --config <shoot.json> <manifest.json>... [--since <src dir>]')
  process.exit(2)
}

const config = JSON.parse(readFileSync(configPath, 'utf8'))
const problems = []

let newestSource = 0
if (since) {
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const p = join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else newestSource = Math.max(newestSource, statSync(p).mtimeMs)
    }
  }
  walk(since)
}

const hashes = new Map()
const skippedWrites = new Set()
const shotSides = new Map()

for (const manifestFile of manifests) {
  if (!existsSync(manifestFile)) {
    console.error(
      `${manifestFile} does not exist — that side has not been shot yet (shoot.mjs --side ...).`,
    )
    process.exit(2)
  }
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
  const side = manifest.side ?? (manifest.branch ? 'new' : 'legacy')
  const root = dirname(resolve(manifestFile))
  const seen = new Set()
  shotSides.set(side, seen)

  for (const shot of manifest.shots ?? []) {
    const id = `${shot.route} / ${shot.state ?? 'default'} @ ${shot.viewport} (${side})`
    seen.add(`${shot.route}|${shot.state ?? 'default'}|${shot.viewport}`)
    const file = resolve(root, shot.file)
    if (!existsSync(file)) {
      problems.push(`${id}: the capture file is gone (${shot.file})`)
      continue
    }

    if (shot.requested && shot.landed) {
      const asked = new URL(shot.requested).pathname.replace(/\/$/, '')
      const landed = new URL(shot.landed).pathname.replace(/\/$/, '')
      if (asked !== landed) problems.push(`${id}: asked for ${asked}, landed on ${landed}`)
    }

    if (since && side === 'new' && new Date(shot.capturedAt).getTime() < newestSource) {
      problems.push(`${id}: shot ${shot.capturedAt}, before the newest change under ${since}`)
    }

    const hash = createHash('sha1').update(readFileSync(file)).digest('hex')
    const twin = hashes.get(hash)
    if (twin && twin.route !== shot.route) {
      problems.push(`${id} is byte-identical to ${twin.id} — two screens, one picture`)
    }
    hashes.set(hash, { route: shot.route, id })
  }
}

/* Completeness against the config: every screen × state a side has, at every
   viewport that side was shot at. */
for (const [side, seen] of shotSides) {
  const viewports = new Set([...seen].map((key) => key.split('|')[2]))
  for (const screen of config.screens ?? []) {
    if (!pathFor(screen, side)) continue
    for (const state of statesFor(screen, side)) {
      for (const viewport of viewports) {
        if (!seen.has(`${screen.key}|${state.key}|${viewport}`)) {
          /* Reached by writing: shoot.mjs skips these unless a staging host is
             confirmed, on purpose. Missing, but not a broken capture. */
          if (state.mutates) {
            skippedWrites.add(`${screen.key} / ${state.key} (${side})`)
            continue
          }
          problems.push(
            `${screen.key} / ${state.key} @ ${viewport} (${side}): in the config, never captured`,
          )
        }
      }
    }
  }
}

if (problems.length) {
  console.error(`${problems.length} problem(s) — fix or re-shoot before pushing:`)
  for (const problem of problems) console.error(`  ${problem}`)
  process.exit(1)
}
if (skippedWrites.size) {
  console.error(
    `${skippedWrites.size} state(s) reached by writing were not shot (shoot.mjs --confirm-host <staging host> takes them):\n` +
      [...skippedWrites].map((s) => `  ${s}`).join('\n'),
  )
}
const total = [...shotSides.values()].reduce((sum, seen) => sum + seen.size, 0)
console.log(`${total} captures check out. Next: diffui push <manifest> --project ${config.project}`)
