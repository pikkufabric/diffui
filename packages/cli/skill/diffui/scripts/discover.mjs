#!/usr/bin/env node
/**
 * Find every screen and panel of one app, from the outside.
 *
 *   node discover.mjs --config shoot.json --side legacy --mode read-only
 *   node discover.mjs --config shoot.json --side new    --mode writes --confirm-host staging.acme.com
 *
 * Works on any app a browser can open — it needs nothing from the app but its
 * URL and a way to sign in (the `sides` block of the shoot config). It:
 *
 *   1. crawls every same-origin link, collapsing `/orders/10421` and
 *      `/orders/10420` into one screen, `/orders/:id`;
 *   2. on each screen, clicks every button, tab, menu trigger and hover-only row
 *      control — each on a fresh copy of the page — and records what appeared:
 *      a dialog, a menu, a listbox, a tab, a validation error, or (in writes
 *      mode) the result of a write;
 *   3. writes `discovery/<side>.json`, which `pair.mjs` matches against the
 *      other side's to draft the shoot config.
 *
 * THE MODE IS REQUIRED, and there is no default:
 *
 *   read-only   Every request that is not a GET is blocked, so clicking "Delete"
 *               deletes nothing. Safe against anything, production included.
 *               Finds panels, dialogs, menus, tabs and client-side validation —
 *               never what a write leads to. An app that READS with POST
 *               (GraphQL, RPC) needs those URLs in `sides.<side>.readOnly.allow`
 *               or its pages come up empty; every blocked write is listed in the
 *               output so an empty page can be explained.
 *   writes      Clicks through for real, to capture what writes lead to too.
 *               Staging only, with disposable data: see the warning it prints.
 *               It asks you to type the host; with no terminal, pass
 *               --confirm-host <host>.
 *
 * In either mode, "Log out" / "Sign out" controls and logout links are never
 * touched — the crawl would sign itself out and photograph the login page for
 * every screen after it.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { ask, loadPlaywright, loadSide, parseFlags, perform, settle, signIn } from './lib.mjs'

const { flag } = parseFlags(process.argv.slice(2))
const configPath = flag('--config')
const side = flag('--side')
const mode = flag('--mode')
const outFile = flag('--out', `discovery/${side}.json`)
const maxPages = Number(flag('--max-pages', 100))
const maxTriggers = Number(flag('--max-triggers', 40))
const workers = Math.max(1, Number(flag('--workers', 2)))

if (!configPath || (side !== 'legacy' && side !== 'new')) {
  console.error(
    'usage: discover.mjs --config <shoot.json> --side <legacy|new> --mode <read-only|writes>\n' +
      '                    [--confirm-host <host>] [--out <file>] [--max-pages n] [--max-triggers n] [--workers n]',
  )
  process.exit(2)
}
if (mode !== 'read-only' && mode !== 'writes') {
  console.error(
    'Choose a mode — there is no default:\n\n' +
      '  --mode read-only   blocks every write; safe anywhere, but never sees what a write leads to\n' +
      '  --mode writes      clicks through for real; staging with disposable data ONLY\n',
  )
  process.exit(2)
}

const { sideConfig } = loadSide(configPath, side)
const base = new URL(sideConfig.baseUrl)

/* ------------------------------------------------------ writes: the warning */

if (mode === 'writes') {
  process.stderr.write(
    `\n  WRITES MODE — ${base.origin}\n\n` +
      '  This clicks every button on every screen FOR REAL: deletes delete, submits submit,\n' +
      '  and anything the app does on a write — emails, webhooks, payments in test mode —\n' +
      '  may actually happen. Data will change as it runs, so screens found late may not\n' +
      '  look like screens found early.\n\n' +
      '  Run it only against a staging environment whose data is disposable, never against\n' +
      '  production, and never against a system shared with anyone who would mind.\n\n',
  )
  const confirmed =
    flag('--confirm-host') ??
    (process.stdin.isTTY ? await ask(`  Type ${base.host} to confirm: `) : null)
  if (confirmed !== base.host) {
    console.error(
      confirmed === null
        ? `  No terminal to confirm on. Pass --confirm-host ${base.host} if this really is staging.`
        : `  "${confirmed}" is not ${base.host}. Nothing was run.`,
    )
    process.exit(2)
  }
}

/* ----------------------------------------------------------------- helpers */

const NEVER_CLICK = /\b(log ?out|sign ?out|log ?off)\b/i
const NEVER_FOLLOW = /(log-?out|sign-?out|logoff)/i
const DOWNLOAD = /\.(pdf|csv|xlsx?|zip|docx?|png|jpe?g|gif|svg)$/i
const extraSkip = (sideConfig.discover?.skip ?? []).map((pattern) => new RegExp(pattern, 'i'))
const skipName = (name) => NEVER_CLICK.test(name) || extraSkip.some((re) => re.test(name))

/** A segment that is data, not structure: an id, a uuid, a hash, a slug with a number. */
const PARAM = /^(\d+|[0-9a-f]{8}-[0-9a-f-]{27,}|[0-9a-f]{16,}|(?=.*\d)[a-z0-9_-]{10,})$/i
const patternOf = (pathname) =>
  pathname
    .replace(/\/+$/, '')
    .split('/')
    .map((segment) => (segment && PARAM.test(segment) ? ':id' : segment))
    .join('/') || '/'

const slug = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'state'

const allowedWrite = (url) => (sideConfig.readOnly?.allow ?? []).some((part) => url.includes(part))

/** What is on screen that a trigger could have opened. Runs in the page. */
const snapshot = (page) =>
  page.evaluate(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
    }
    const labelOf = (el) => {
      const by = el.getAttribute('aria-labelledby')
      const text =
        (by && document.getElementById(by)?.textContent) ||
        el.getAttribute('aria-label') ||
        el.querySelector('h1,h2,h3,[role=heading]')?.textContent ||
        ''
      return text.trim().replace(/\s+/g, ' ').slice(0, 60)
    }
    const overlays = [
      ...document.querySelectorAll(
        '[role=dialog],[role=alertdialog],[aria-modal=true],dialog[open],[role=menu],[role=listbox],[role=tooltip]',
      ),
    ]
      .filter(visible)
      .map((el) => ({
        role: el.getAttribute('role') ?? (el.tagName === 'DIALOG' ? 'dialog' : 'dialog'),
        label: labelOf(el),
      }))
    const selectedTab =
      document.querySelector('[role=tab][aria-selected=true]')?.textContent?.trim() ?? null
    const invalid =
      document.querySelectorAll('[aria-invalid=true]').length +
      [...document.querySelectorAll('input,select,textarea')].filter(
        (el) => el.matches(':invalid') && el.matches(':user-invalid, [data-touched]'),
      ).length
    const alerts = [...document.querySelectorAll('[role=alert],[role=status]')]
      .filter(visible)
      .map((el) => el.textContent.trim().replace(/\s+/g, ' ').slice(0, 80))
      .filter(Boolean)
    const expanded = [...document.querySelectorAll('[aria-expanded=true]')].map((el) =>
      (el.getAttribute('aria-label') || el.textContent).trim().slice(0, 60),
    )
    return { overlays, selectedTab, invalid, alerts, expanded }
  })

/** Every control on the page worth one click, deduplicated. Runs in the page. */
const findTriggers = (page) =>
  page.evaluate(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
    }
    const seen = new Set()
    const out = []
    const candidates = document.querySelectorAll(
      'button, [role=button], [role=tab], [aria-haspopup], [aria-expanded], summary, a[href="#"], input[type=submit]',
    )
    for (const el of candidates) {
      if (el.closest('[aria-hidden=true]') || el.disabled) continue
      const role =
        el.getAttribute('role') ??
        (el.tagName === 'A' ? 'link' : el.tagName === 'SUMMARY' ? 'summary' : 'button')
      const name = (
        el.getAttribute('aria-label') ||
        el.value ||
        el.textContent ||
        el.getAttribute('title') ||
        ''
      )
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 60)
      if (!name) continue
      const row = el.closest('tbody tr, [role=row]')
      const shown = visible(el)
      /* A control hidden until its row is hovered is still a control; one hidden
         for any other reason is not reachable by a user either. */
      if (!shown && !row) continue
      /* Fifty "Edit" buttons, one per row, are one control. */
      const key = `${role}|${name}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        role,
        name,
        hiddenInRow: !shown,
        /* The first row with data cells: browsers insert a <tbody> even when the
           markup has none, so `tbody tr` alone is the header row — which has no
           row menu to reveal. */
        rowSelector: row
          ? row.tagName === 'TR'
            ? 'tbody tr:has(td)'
            : '[role=row]:has([role=cell],[role=gridcell])'
          : null,
      })
    }
    return out
  })

const ROLE_SELECTABLE = new Set([
  'button',
  'tab',
  'link',
  'menuitem',
  'checkbox',
  'switch',
  'combobox',
])
const openerFor = (trigger) => {
  const target = ROLE_SELECTABLE.has(trigger.role)
    ? `role=${trigger.role}[name=${JSON.stringify(trigger.name)}]`
    : `text=${JSON.stringify(trigger.name)}`
  return trigger.hiddenInRow ? [`hover ${trigger.rowSelector} >> nth=0`, target] : [target]
}

/* ---------------------------------------------------------------- the crawl */

const { chromium } = await loadPlaywright()
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const landing = await signIn(context, side, sideConfig)

/* Sign-in may need a POST; everything after it may not. */
const blockedWrites = []
if (mode === 'read-only') {
  await context.route('**/*', (route) => {
    const request = route.request()
    const method = request.method()
    if (['GET', 'HEAD', 'OPTIONS'].includes(method) || allowedWrite(request.url())) {
      return route.continue()
    }
    blockedWrites.push({ method, url: request.url() })
    return route.abort('blockedbyclient')
  })
}

const loginPattern = sideConfig.auth?.path ? patternOf(sideConfig.auth.path) : null
const screens = new Map()
const redirects = []
const errors = []
/* Start where signing in lands — the app's own home, which on a rebuild under
   `/app` is not `/` — unless the config names start pages. */
const queue = (sideConfig.start ?? [landing ?? '/']).map((path) => new URL(path, base).href)
const queued = new Set(queue.map((href) => patternOf(new URL(href).pathname)))
let signedOut = false

const visit = async (href) => {
  const page = await context.newPage()
  try {
    await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await settle(page, sideConfig, sideConfig.settled, 300)
    const landed = new URL(page.url())
    if (landed.origin !== base.origin) return
    const asked = new URL(href)
    if (landed.pathname.replace(/\/$/, '') !== asked.pathname.replace(/\/$/, '')) {
      redirects.push({ from: asked.pathname, to: landed.pathname })
    }
    const pattern = patternOf(landed.pathname)
    if (loginPattern && pattern === loginPattern && sideConfig.auth?.kind !== 'none') {
      signedOut = true
      return
    }
    if (screens.has(pattern)) return
    const info = await page.evaluate(() => ({
      title: document.title,
      h1: document.querySelector('h1')?.textContent?.trim() ?? null,
      headings: [...document.querySelectorAll('h1,h2,h3')]
        .map((h) => h.textContent.trim().replace(/\s+/g, ' '))
        .filter(Boolean)
        .slice(0, 12),
      links: [...document.querySelectorAll('a[href]')].map((a) => a.href),
    }))
    screens.set(pattern, {
      pattern,
      path: landed.pathname + landed.search,
      title: info.title,
      h1: info.h1,
      headings: info.headings,
      buttons: [],
      states: [],
    })
    for (const link of info.links) {
      let url
      try {
        url = new URL(link)
      } catch {
        continue
      }
      if (
        url.origin !== base.origin ||
        NEVER_FOLLOW.test(url.pathname) ||
        DOWNLOAD.test(url.pathname)
      ) {
        continue
      }
      const linkPattern = patternOf(url.pathname)
      if (queued.has(linkPattern) || queued.size >= maxPages) continue
      queued.add(linkPattern)
      url.hash = ''
      queue.push(url.href)
    }
  } catch (error) {
    errors.push(`${href}: ${error.message}`)
  } finally {
    await page.close()
  }
}

/* One trigger, on a fresh copy of the page, and what it changed. */
const trial = async (screen, trigger) => {
  const page = await context.newPage()
  const writes = []
  page.on('request', (request) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.url())
  })
  try {
    await page.goto(new URL(screen.path, base).href, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    })
    await settle(page, sideConfig, sideConfig.settled, 300)
    const before = await snapshot(page)
    const beforePath = new URL(page.url()).pathname
    writes.length = 0
    const open = openerFor(trigger)
    for (const step of open) await perform(page, step)
    await settle(page, sideConfig, null, 400)
    const afterPath = new URL(page.url()).pathname
    if (afterPath !== beforePath) {
      return { navigatedTo: afterPath }
    }
    const after = await snapshot(page)
    const had = new Set(before.overlays.map((o) => `${o.role}|${o.label}`))
    const appeared = after.overlays.find((o) => !had.has(`${o.role}|${o.label}`))
    const mutated = writes.length > 0

    if (appeared) {
      const label = appeared.label || trigger.name
      return {
        state: {
          label,
          kind: appeared.role,
          open,
          settled: `role=${appeared.role}`,
          ...(mutated ? { mutates: true } : {}),
        },
      }
    }
    if (trigger.role === 'tab' && after.selectedTab !== before.selectedTab) {
      return {
        state: { label: `${trigger.name} tab`, kind: 'tab', open, settled: 'role=tabpanel' },
      }
    }
    if (after.invalid > before.invalid) {
      return {
        state: {
          label: `${trigger.name} — validation`,
          kind: 'validation',
          open,
          settled: '[aria-invalid=true]',
        },
      }
    }
    if (mutated && mode === 'writes') {
      const newAlert = after.alerts.find((a) => !before.alerts.includes(a))
      return {
        state: {
          label: newAlert ? `After ${trigger.name}: ${newAlert}` : `After ${trigger.name}`,
          kind: 'result',
          open,
          settled: newAlert ? 'role=alert' : null,
          mutates: true,
        },
      }
    }
    if (mutated) return { blocked: trigger.name }
    const newlyExpanded = after.expanded.find((e) => !before.expanded.includes(e))
    if (newlyExpanded) {
      return {
        state: {
          label: `${newlyExpanded} expanded`,
          kind: 'expanded',
          open,
          settled: '[aria-expanded=true]',
        },
      }
    }
    return {}
  } catch (error) {
    return { error: `${screen.pattern} → ${trigger.name}: ${error.message.split('\n')[0]}` }
  } finally {
    await page.close()
  }
}

const panels = async (screen) => {
  const page = await context.newPage()
  let triggers = []
  try {
    await page.goto(new URL(screen.path, base).href, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    })
    await settle(page, sideConfig, sideConfig.settled, 300)
    triggers = (await findTriggers(page)).filter((t) => !skipName(t.name)).slice(0, maxTriggers)
  } finally {
    await page.close()
  }
  screen.buttons = triggers.map((t) => t.name)
  const writesTried = []
  const lanes = Array.from({ length: workers }, (_, i) =>
    triggers.filter((_, j) => j % workers === i),
  )
  const results = (
    await Promise.all(
      lanes.map(async (lane) => {
        const out = []
        for (const trigger of lane) out.push(await trial(screen, trigger))
        return out
      }),
    )
  ).flat()

  const keys = new Set(['default'])
  for (const result of results) {
    if (result.error) errors.push(result.error)
    if (result.blocked) writesTried.push(result.blocked)
    if (result.navigatedTo) {
      const pattern = patternOf(result.navigatedTo)
      if (!queued.has(pattern) && queued.size < maxPages) {
        queued.add(pattern)
        queue.push(new URL(result.navigatedTo, base).href)
      }
    }
    if (result.state) {
      let key = slug(result.state.label)
      if (keys.has(key)) {
        /* The same panel reached two ways is one state. */
        if (screen.states.some((s) => s.label === result.state.label)) continue
        let n = 2
        while (keys.has(`${key}-${n}`)) n++
        key = `${key}-${n}`
      }
      keys.add(key)
      screen.states.push({ key, ...result.state })
    }
  }
  if (writesTried.length) screen.writesBlocked = writesTried
}

/* Crawl, then open panels, then crawl whatever the panels navigated to — until
   nothing new turns up or the page budget is spent. */
const done = new Set()
while (queue.length && !signedOut) {
  while (queue.length && !signedOut) await visit(queue.shift())
  for (const screen of screens.values()) {
    if (done.has(screen.pattern)) continue
    done.add(screen.pattern)
    process.stderr.write(`  ${screen.pattern}`)
    await panels(screen)
    process.stderr.write(
      screen.states.length ? `  → ${screen.states.map((s) => s.key).join(', ')}\n` : '\n',
    )
  }
}
await browser.close()

if (signedOut) {
  errors.push(
    'The crawl was sent back to the login page, so it stopped: the session ended or a link signed it out. ' +
      'Add the control that did it to sides.<side>.discover.skip.',
  )
}

const result = {
  side,
  baseUrl: base.origin,
  mode,
  discoveredAt: new Date().toISOString(),
  screens: [...screens.values()].sort((a, b) => a.pattern.localeCompare(b.pattern)),
  redirects,
  ...(mode === 'read-only'
    ? { blockedWrites: blockedWrites.map((w) => `${w.method} ${new URL(w.url).pathname}`) }
    : {}),
  errors,
}
mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`)

const stateCount = result.screens.reduce((n, s) => n + s.states.length, 0)
console.error(
  `\n${result.screens.length} screens, ${stateCount} panels and states → ${outFile}` +
    (errors.length ? `  (${errors.length} errors — see "errors")` : '') +
    (mode === 'read-only' && blockedWrites.length
      ? `\n${new Set(result.blockedWrites).size} distinct writes were blocked. If a page came up empty, ` +
        'it may read with POST: add those URLs to sides.' +
        side +
        '.readOnly.allow.'
      : ''),
)
process.exitCode = signedOut ? 1 : 0
