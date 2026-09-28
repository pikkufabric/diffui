#!/usr/bin/env node
/**
 * Turn the shoot config into the screen inventory `diffui init` reads.
 *
 *   node routes.mjs shoot.json > routes.json && diffui init routes.json --project <p>
 *
 * The shoot config is the ONE list of screens: what gets declared to diffui and
 * what gets photographed come from the same file, so a shot can never name a
 * screen or state nobody declared (diffui refuses those anyway, after the upload).
 *
 * Only the diffui fields are copied. The browser details (`open`, `settled`) stay
 * in the config; `ref` carries the opener so a person reading the report can see
 * how a state was reached.
 */
import { readFileSync } from 'node:fs'

const [configPath] = process.argv.slice(2)
if (!configPath) {
  console.error('usage: routes.mjs <shoot.json>')
  process.exit(2)
}

const config = JSON.parse(readFileSync(configPath, 'utf8'))

/* A note for a person reading the report: how the state is reached, per side. */
const describeOpeners = (open) => {
  if (!open) return null
  if (Array.isArray(open)) return open.length ? `opened by: ${open.join(' → ')}` : null
  return Object.entries(open)
    .map(([side, steps]) => `${side}: ${steps.join(' → ')}`)
    .join(' | ')
}
const problems = []

const routes = (config.screens ?? []).map((screen) => {
  if (screen.legacyAbsent && screen.legacyPath) {
    problems.push(`${screen.key}: says legacy lacks it AND gives legacyPath ${screen.legacyPath}`)
  }
  return {
    key: screen.key,
    label: screen.label ?? screen.key,
    legacyPath: screen.legacyPath ?? null,
    newPath: screen.newPath ?? null,
    ...(screen.legacyAbsent ? { legacyAbsent: true } : {}),
    ...(screen.states?.length
      ? {
          states: screen.states.map((state) => ({
            key: state.key,
            label: state.label ?? state.key,
            ref: describeOpeners(state.open),
          })),
        }
      : {}),
  }
})

if (problems.length) {
  console.error(problems.join('\n'))
  process.exit(1)
}
process.stdout.write(`${JSON.stringify({ routes }, null, 2)}\n`)
