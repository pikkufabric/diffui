#!/usr/bin/env node
/**
 * Photograph one side of the migration, ready for `diffui push`.
 *
 *   node shoot.mjs --config shoot.json --side legacy --out shots/legacy
 *   node shoot.mjs --config shoot.json --side new    --out shots/new --workers 4
 *   node shoot.mjs --config shoot.json --side new    --out shots/new --only orders,orders.detail
 *
 * Writes `<out>/<route>.<state>.<viewport>.png` and `<out>/manifest.json` in the
 * shape `diffui push` reads. A re-shoot MERGES into the manifest, replacing only
 * the shots it retook, so `--only` can fix one screen without losing the rest.
 *
 * Each shot also records `requested` (the URL asked for) and `landed` (the URL
 * the browser ended on). `diffui push` ignores both; `check.mjs` reads them to
 * catch the silent redirect that makes three screens byte-identical dashboards.
 *
 * VIEWPORTS COME FROM DIFFUI, not from this config. The config names keys
 * (`"viewports": ["desktop", "mobile"]`); the sizes are read from the project
 * (`diffui projects show <p> --json`), so a capture can never be at a size the
 * project does not declare, and changing a resolution is changed in one place.
 *
 * CREDENTIALS ARE NEVER READ FROM THE CONFIG. They come from the environment
 * (LEGACY_USER / LEGACY_PASS / LEGACY_TOKEN, NEW_USER / NEW_PASS / NEW_TOKEN) or
 * from a prompt with echo off, and are written nowhere: not the manifest, not a
 * filename, not a log line.
 *
 * Needs Playwright in the consuming repo (`npm i -D playwright` and
 * `npx playwright install chromium`). The `diffui` command is taken from
 * $DIFFUI_BIN when set (e.g. `bun path/to/cli/src/index.ts`), else `diffui`.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  loadPlaywright,
  loadSide,
  openersFor,
  parseFlags,
  pathFor,
  perform,
  settle,
  settledFor,
  signIn,
  statesFor,
} from './lib.mjs'

const { flag } = parseFlags(process.argv.slice(2))
const configPath = flag('--config')
const side = flag('--side')
const outDir = flag('--out', side ? `shots/${side}` : null)
const workers = Math.max(1, Number(flag('--workers', 1)))
const only = flag('--only')?.split(',')
if (!configPath || (side !== 'legacy' && side !== 'new')) {
  console.error(
    'usage: shoot.mjs --config <shoot.json> --side <legacy|new> [--out <dir>] [--workers n] [--only key,key] [--confirm-host <host>]',
  )
  process.exit(2)
}

const { config, sideConfig } = loadSide(configPath, side)

/* A state discovered in writes mode (`mutates: true`) is reached BY writing, so
   photographing it writes again. Those are skipped unless the host is confirmed
   exactly as discover.mjs --mode writes asks for it. */
const writesHost = flag('--confirm-host')
const allowWrites = writesHost === new URL(sideConfig.baseUrl).host
if (writesHost && !allowWrites) {
  console.error(
    `--confirm-host ${writesHost} is not ${new URL(sideConfig.baseUrl).host}. Nothing was run.`,
  )
  process.exit(2)
}
if (side === 'new' && !sideConfig.branch) {
  console.error('sides.new needs a `branch`: the diffui branch key this rebuild pushes as.')
  process.exit(2)
}

/* ------------------------------------------------------------- viewports */

const diffui = (args) => {
  const [command, ...prefix] = (process.env.DIFFUI_BIN ?? 'diffui').split(' ').filter(Boolean)
  return execFileSync(command, [...prefix, ...args], { encoding: 'utf8' })
}

const readViewports = () => {
  if (!config.project) {
    console.error('The config needs `project`: the diffui project slug these screens belong to.')
    process.exit(2)
  }
  let project
  try {
    project = JSON.parse(diffui(['projects', 'show', config.project, '--json']))
  } catch (error) {
    console.error(
      `Could not read project \`${config.project}\` from diffui: ${error.message}\n` +
        'Sign in with `diffui login`, or set DIFFUI_BIN if the CLI is not on PATH.',
    )
    process.exit(2)
  }
  const wanted = config.viewports ?? project.viewports.map((v) => v.key)
  const byKey = new Map(project.viewports.map((v) => [v.key, v]))
  const missing = wanted.filter((key) => !byKey.has(key))
  if (missing.length) {
    console.error(
      `The project declares no resolution called ${missing.map((k) => `\`${k}\``).join(', ')}. ` +
        `It has: ${[...byKey.keys()].join(', ')}.`,
    )
    process.exit(2)
  }
  return wanted.map((key) => byKey.get(key))
}

/* ---------------------------------------------------------------- the work */

const screens = (config.screens ?? []).filter((s) => !only || only.includes(s.key))
const path = (screen) => pathFor(screen, side)

/* One job per screen × state that this side actually has. A legacy-absent
   screen has nothing to shoot on the legacy side, an unbuilt one nothing on the
   new side, and a dialog with no opener on a side does not exist there — all
   answers diffui's report gives, not failures here. */
const jobs = screens.flatMap((screen) =>
  path(screen)
    ? statesFor(screen, side)
        .filter((state) => allowWrites || !state.mutates)
        .map((state) => ({ screen, state }))
    : [],
)
const skippedWrites = screens.flatMap((screen) =>
  path(screen) ? statesFor(screen, side).filter((s) => s.mutates && !allowWrites) : [],
)
if (skippedWrites.length) {
  console.error(
    `  skipping ${skippedWrites.length} state(s) that are reached by writing; ` +
      `pass --confirm-host ${new URL(sideConfig.baseUrl).host} to shoot them (staging only)`,
  )
}

const manifestPath = join(outDir, 'manifest.json')
mkdirSync(outDir, { recursive: true })
const manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, 'utf8'))
  : { side, ...(side === 'new' ? { branch: sideConfig.branch } : {}), shots: [] }
if (side === 'new') manifest.branch = sideConfig.branch
const shotId = (s) => `${s.route}|${s.state}|${s.viewport}`

const { chromium } = await loadPlaywright()

const viewports = readViewports()
const browser = await chromium.launch()
const taken = []
let failures = 0

for (const viewport of viewports) {
  /* Touch emulation below tablet width. Off, a phone-width capture silently
     renders the desktop navigation on any layout keyed to pointer type, and two
     desktop screens get compared while everyone believes they are phones. */
  const mobile = viewport.width < 700
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor ?? 1,
    isMobile: mobile,
    hasTouch: mobile,
  })
  await signIn(context, side, sideConfig)

  /* Round-robin lanes, not blocks: slow captures cluster (a table's menu and
     dialog states sit together), and a block split gives one worker all of them. */
  const lanes = Array.from({ length: workers }, (_, i) => jobs.filter((_, j) => j % workers === i))
  await Promise.all(
    lanes.map(async (lane) => {
      for (const { screen, state } of lane) {
        const label = `${screen.key} / ${state.key} @ ${viewport.key}`
        const page = await context.newPage()
        try {
          const requested = new URL(path(screen), sideConfig.baseUrl).href
          await page.goto(requested, { waitUntil: 'domcontentloaded', timeout: 60_000 })
          const openers = openersFor(state, side) ?? []
          await settle(
            page,
            sideConfig,
            openers.length ? sideConfig.settled : (settledFor(state, side) ?? sideConfig.settled),
          )
          for (const step of openers) await perform(page, step)
          if (openers.length) await settle(page, sideConfig, settledFor(state, side))

          const file = join(outDir, `${screen.key}.${state.key}.${viewport.key}.png`)
          await page.screenshot({ path: file, fullPage: screen.fullPage !== false })
          const landed = page.url()
          taken.push({
            route: screen.key,
            state: state.key,
            viewport: viewport.key,
            file: relative(outDir, file),
            capturedAt: new Date().toISOString(),
            requested,
            landed,
          })
          if (new URL(landed).pathname !== new URL(requested).pathname) {
            console.error(`  ! ${label}: asked for ${requested}, landed on ${landed}`)
          } else {
            process.stderr.write(`  ${label}\n`)
          }
        } catch (error) {
          failures++
          console.error(`  FAILED ${label}: ${error.message}`)
        } finally {
          await page.close()
        }
      }
    }),
  )
  await context.close()
}
await browser.close()

/* Merge: a retaken shot replaces its old entry, and an old entry survives only
   while the config still asks for it on this side. Without that last rule a
   screen dropped from the config, or no longer built, keeps its stale shot
   forever — and `diffui push` would keep sending it. */
const wanted = new Set(
  (config.screens ?? []).flatMap((screen) =>
    path(screen) ? statesFor(screen, side).map((state) => `${screen.key}|${state.key}`) : [],
  ),
)
const wantedViewports = new Set(viewports.map((v) => v.key))
const retaken = new Set(taken.map(shotId))
const kept = manifest.shots.filter(
  (s) =>
    !retaken.has(shotId(s)) &&
    wanted.has(`${s.route}|${s.state}`) &&
    (!config.viewports || wantedViewports.has(s.viewport)),
)
const dropped = manifest.shots.filter((s) => !retaken.has(shotId(s)) && !kept.includes(s)).length
if (dropped > 0) console.error(`  dropped ${dropped} old shot(s) the config no longer asks for`)
manifest.shots = [...kept, ...taken]
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

console.error(
  `\n${taken.length} captures written to ${outDir} (${failures} failed). ` +
    `Next: node check.mjs --config ${configPath} <legacy manifest> <new manifest>`,
)
process.exitCode = failures ? 1 : 0
