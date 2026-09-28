#!/usr/bin/env node
/**
 * Match what discover.mjs found on each side, and draft the shoot config.
 *
 *   node pair.mjs --config shoot.json discovery/legacy.json discovery/new.json [--out shoot.draft.json]
 *
 * The two apps share nothing — not paths, not markup, not ids — so screens are
 * matched on what a PERSON sees: the page title and heading, the section
 * headings, the buttons, and the words in the path. Panels are matched within a
 * pair by their titles. The result is a PROPOSAL: every pair carries its score
 * and the evidence for it, and anything below the bar is left unpaired rather
 * than guessed.
 *
 * Writes the shoot config's `sides`, `project` and `viewports` through untouched
 * and replaces `screens`. It writes to --out (default shoot.draft.json), never
 * over the config itself, so hand edits are not lost to a re-run.
 *
 * READ THE DRAFT BEFORE USING IT. Low-score pairs, screens only one side has,
 * and `:id` screens (whose two example records may not be the same one) are
 * listed on stderr for a person to confirm.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { parseFlags } from './lib.mjs'

const argv = process.argv.slice(2)
const { flag } = parseFlags(argv)
const configPath = flag('--config')
const outFile = flag('--out', 'shoot.draft.json')
const threshold = Number(flag('--threshold', 0.25))
const [legacyFile, newFile] = argv.filter(
  (a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'),
)
if (!configPath || !legacyFile || !newFile) {
  console.error(
    'usage: pair.mjs --config <shoot.json> <discovery/legacy.json> <discovery/new.json> [--out <file>] [--threshold 0.25]',
  )
  process.exit(2)
}

const config = JSON.parse(readFileSync(configPath, 'utf8'))
const legacy = JSON.parse(readFileSync(legacyFile, 'utf8'))
const rebuild = JSON.parse(readFileSync(newFile, 'utf8'))

/* ------------------------------------------------------------- similarity */

const STOP = new Set([
  'the',
  'a',
  'an',
  'of',
  'and',
  'or',
  'to',
  'in',
  'for',
  'on',
  'your',
  'new',
  'id',
])
const words = (text) =>
  (text ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => (w.length > 3 ? w.replace(/(ies|es|s)$/, '') : w))

/**
 * Words on (nearly) every screen of a side are its chrome — the app's name in
 * every title, the nav on every page — and say nothing about which screen this
 * is. Dropped per side, because the two apps' chrome differs.
 */
const chromeOf = (screens) => {
  const df = new Map()
  for (const screen of screens) {
    for (const w of new Set([
      ...words(screen.title),
      ...screen.headings.flatMap(words),
      ...screen.buttons.flatMap(words),
    ])) {
      df.set(w, (df.get(w) ?? 0) + 1)
    }
  }
  return new Set(
    [...df].filter(([, n]) => screens.length > 2 && n / screens.length > 0.6).map(([w]) => w),
  )
}

const profile = (screen, chrome) => {
  const keep = (list) => new Set(list.filter((w) => !chrome.has(w)))
  return {
    title: keep([...words(screen.title), ...words(screen.h1)]),
    headings: keep(screen.headings.flatMap(words)),
    buttons: keep(screen.buttons.flatMap(words)),
    path: keep(words(screen.pattern.replace(/:id/g, ''))),
    hasParam: screen.pattern.includes(':id'),
  }
}

const jaccard = (a, b) => {
  if (!a.size && !b.size) return 0
  let shared = 0
  for (const w of a) if (b.has(w)) shared++
  return shared / (a.size + b.size - shared)
}

const score = (a, b) =>
  0.35 * jaccard(a.title, b.title) +
  0.25 * jaccard(a.headings, b.headings) +
  0.25 * jaccard(a.buttons, b.buttons) +
  0.15 * jaccard(a.path, b.path) -
  /* A list and a detail page share their words; they are not the same screen. */
  (a.hasParam !== b.hasParam ? 0.15 : 0)

/* ---------------------------------------------------------------- pairing */

const legacyChrome = chromeOf(legacy.screens)
const newChrome = chromeOf(rebuild.screens)
const L = legacy.screens.map((s) => ({ screen: s, p: profile(s, legacyChrome) }))
const N = rebuild.screens.map((s) => ({ screen: s, p: profile(s, newChrome) }))

const candidates = []
for (const l of L) for (const n of N) candidates.push({ l, n, score: score(l.p, n.p) })
candidates.sort((a, b) => b.score - a.score)

const takenL = new Set()
const takenN = new Set()
const pairs = []
for (const c of candidates) {
  if (c.score < threshold || takenL.has(c.l) || takenN.has(c.n)) continue
  takenL.add(c.l)
  takenN.add(c.n)
  pairs.push(c)
}

/* A screen's key: its structure, not its data — the rebuild's path when it has
   one, without the prefix every rebuild path shares (`/app`), params as
   `detail`. `/app/orders/:id` → `orders.detail`. */
const commonPrefix = (patterns) => {
  const split = patterns.map((p) => p.split('/').filter(Boolean))
  const first = split[0] ?? []
  let n = 0
  while (
    split.length > 1 &&
    n < first.length &&
    split.every((s) => s[n] === first[n] && !first[n].startsWith(':'))
  )
    n++
  return n
}
const prefixFor = {
  legacy: commonPrefix(legacy.screens.map((s) => s.pattern)),
  new: commonPrefix(rebuild.screens.map((s) => s.pattern)),
}
const keyOf = (pattern, side) => {
  const segments = pattern.split('/').filter(Boolean).slice(prefixFor[side])
  const key = segments
    .map((s) => (s.startsWith(':') ? 'detail' : s.toLowerCase().replace(/[^a-z0-9-]+/g, '-')))
    .join('.')
  return key || 'home'
}
const usedKeys = new Set()
const uniqueKey = (key) => {
  let k = key
  let n = 2
  while (usedKeys.has(k)) k = `${key}-${n++}`
  usedKeys.add(k)
  return k
}

const stateWords = (state) => new Set(words(state.label))
const pairStates = (ls, ns) => {
  const out = []
  const usedN = new Set()
  for (const l of ls) {
    let best = null
    for (const n of ns) {
      if (usedN.has(n) || n.kind !== l.kind) continue
      const s = jaccard(stateWords(l), stateWords(n))
      if (s >= 0.3 && (!best || s > best.s)) best = { n, s }
    }
    if (best) usedN.add(best.n)
    out.push({ l, n: best?.n ?? null })
  }
  for (const n of ns) if (!usedN.has(n)) out.push({ l: null, n })
  return out
}

const toState = ({ l, n }, keys) => {
  const label = n?.label ?? l.label
  let key = (n ?? l).key
  while (keys.has(key)) key = `${key}-2`
  keys.add(key)
  return {
    key,
    label,
    open: { ...(l ? { legacy: l.open } : {}), ...(n ? { new: n.open } : {}) },
    settled: {
      ...(l?.settled ? { legacy: l.settled } : {}),
      ...(n?.settled ? { new: n.settled } : {}),
    },
    ...(l?.mutates || n?.mutates ? { mutates: true } : {}),
  }
}

const review = []
const screens = []

for (const { l, n, score: s } of pairs) {
  const key = uniqueKey(keyOf(n.screen.pattern, 'new'))
  const keys = new Set(['default'])
  const states = pairStates(l.screen.states, n.screen.states).map((pair) => toState(pair, keys))
  screens.push({
    key,
    label: n.screen.h1 || n.screen.title || key,
    legacyPath: l.screen.path,
    newPath: n.screen.path,
    ...(states.length ? { states: [{ key: 'default', label: 'Default' }, ...states] } : {}),
    pairing: {
      score: Number(s.toFixed(2)),
      legacy: `${l.screen.pattern} — ${l.screen.h1 || l.screen.title}`,
      new: `${n.screen.pattern} — ${n.screen.h1 || n.screen.title}`,
    },
  })
  if (s < 0.45)
    review.push(`${key}: weak match (${s.toFixed(2)}) — ${l.screen.pattern} ↔ ${n.screen.pattern}`)
  if (l.screen.pattern.includes(':id')) {
    review.push(
      `${key}: ${l.screen.path} and ${n.screen.path} must show the SAME record, or the diff compares two different orders`,
    )
  }
  for (const state of states) {
    if (!state.open.new)
      review.push(
        `${key} / ${state.key}: legacy has it, the rebuild has not built it (or discovery missed its opener)`,
      )
    else if (!state.open.legacy)
      review.push(`${key} / ${state.key}: only the rebuild has it — confirm legacy really lacks it`)
  }
}

for (const l of L.filter((x) => !takenL.has(x))) {
  const key = uniqueKey(keyOf(l.screen.pattern, 'legacy'))
  const keys = new Set(['default'])
  const states = l.screen.states.map((st) => toState({ l: st, n: null }, keys))
  screens.push({
    key,
    label: l.screen.h1 || l.screen.title || key,
    legacyPath: l.screen.path,
    ...(states.length ? { states: [{ key: 'default', label: 'Default' }, ...states] } : {}),
  })
  review.push(
    `${key}: legacy only (${l.screen.pattern}) — not built yet, or its rebuild screen was not matched`,
  )
}

for (const n of N.filter((x) => !takenN.has(x))) {
  const key = uniqueKey(keyOf(n.screen.pattern, 'new'))
  const keys = new Set(['default'])
  const states = n.screen.states.map((st) => toState({ l: null, n: st }, keys))
  screens.push({
    key,
    label: n.screen.h1 || n.screen.title || key,
    newPath: n.screen.path,
    ...(states.length ? { states: [{ key: 'default', label: 'Default' }, ...states] } : {}),
  })
  review.push(
    `${key}: rebuild only (${n.screen.pattern}) — if legacy really has no such screen, set "legacyAbsent": true; ` +
      'if it does, add its legacyPath',
  )
}

screens.sort((a, b) => a.key.localeCompare(b.key))
writeFileSync(outFile, `${JSON.stringify({ ...config, screens }, null, 2)}\n`)

console.error(
  `${pairs.length} screens paired, ${L.length - pairs.length} legacy only, ${N.length - pairs.length} rebuild only → ${outFile}`,
)
if (review.length) {
  console.error(`\nFor a person to confirm (${review.length}):`)
  for (const line of review) console.error(`  - ${line}`)
}
