/**
 * What discover.mjs and shoot.mjs share: reading the config, signing in without
 * leaking credentials, waiting for a screen, and opening a panel.
 *
 * One copy, so the page discovery found a dialog on is opened the same way when
 * it is photographed. Two copies would drift, and the drift would show up as a
 * "no opener matched" that looks like a missing feature.
 */
import { readFileSync } from 'node:fs'

export const parseFlags = (argv) => {
  const flag = (name, fallback = null) => {
    const i = argv.indexOf(name)
    return i === -1 ? fallback : argv[i + 1]
  }
  return { flag, has: (name) => argv.includes(name) }
}

export const loadSide = (configPath, side) => {
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  const sideConfig = config.sides?.[side]
  if (!sideConfig?.baseUrl) {
    console.error(`The config has no sides.${side}.baseUrl.`)
    process.exit(2)
  }
  return { config, sideConfig }
}

/**
 * A state's openers and ready-selector for one side.
 *
 * `open` / `settled` may be shared (`["..."]`) when both apps use the same
 * markup, or per side (`{ "legacy": [...], "new": [...] }`) — which is the usual
 * case, because the rebuild's button is not the legacy one. A state with no
 * opener for this side does not exist on it: the rebuild has not built that
 * dialog yet, and diffui's report says so.
 */
export const openersFor = (state, side) =>
  Array.isArray(state.open) ? state.open : (state.open?.[side] ?? null)
export const settledFor = (state, side) =>
  typeof state.settled === 'string' ? state.settled : (state.settled?.[side] ?? null)

export const pathFor = (screen, side) => (side === 'legacy' ? screen.legacyPath : screen.newPath)

/** The screen's states that exist on this side; a screen with none has `default`. */
export const statesFor = (screen, side) =>
  (screen.states?.length ? screen.states : [{ key: 'default' }]).filter(
    (state) => !state.open || openersFor(state, side) !== null,
  )

/* ------------------------------------------------------------ credentials */

/**
 * A secret from the environment, else from the terminal with echo off. There is
 * deliberately no third option: a flag lands in shell history and in `ps`, and a
 * config file is one `git add .` from being permanent.
 */
export const secret = async (label, envName) => {
  if (process.env[envName]) return process.env[envName]
  if (!process.stdin.isTTY) {
    console.error(`${envName} is not set and there is no terminal to ask on.`)
    process.exit(2)
  }
  process.stderr.write(`${label}: `)
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.setEncoding('utf8')
  return new Promise((resolve) => {
    let value = ''
    const onData = (input) => {
      for (const char of input) {
        if (char === '\r' || char === '\n') {
          process.stdin.setRawMode(false)
          process.stdin.pause()
          process.stdin.off('data', onData)
          process.stderr.write('\n')
          return resolve(value)
        }
        if (char === '\u0003') process.exit(130)
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1)
        else value += char
      }
    }
    process.stdin.on('data', onData)
  })
}

/** A plain question on the terminal, echoed. For confirmations, never for secrets. */
export const ask = async (question) => {
  const { createInterface } = await import('node:readline')
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    }),
  )
}

/* ---------------------------------------------------------------- browser */

export const loadPlaywright = async () => {
  try {
    return await import('playwright')
  } catch {
    console.error(
      'Playwright is not installed here: `npm i -D playwright && npx playwright install chromium`.',
    )
    process.exit(2)
  }
}

/**
 * Wait for the SCREEN, not the clock. A blind sleep works with one browser and
 * fails with four on one dev server, where every failure reads like a missing
 * component. Loader gone, network quiet, then the things that decode late:
 * images (shot early they come back white and read as a styling bug) and fonts.
 */
export const settle = async (page, sideConfig, selector, settleMs = null) => {
  if (sideConfig.loader) {
    await page
      .waitForSelector(sideConfig.loader, { state: 'detached', timeout: 30_000 })
      .catch(() => {})
  }
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
  if (selector) await page.waitForSelector(selector, { timeout: 20_000 }).catch(() => {})
  await page.waitForTimeout(settleMs ?? Number(process.env.SETTLE_MS ?? 700))
  await page
    .evaluate(async () => {
      await Promise.all(
        Array.from(document.images)
          .filter((image) => !image.complete)
          .map((image) => image.decode().catch(() => {})),
      )
      if (document.fonts?.ready) await document.fonts.ready
    })
    .catch(() => {})
}

/**
 * Perform one opener step.
 *
 * `hover <selector>` only moves the mouse there: how a row reveals the menu
 * button it holds at `visibility: hidden`. Anything else is clicked. Each may be
 * a comma-separated union, polled — the control moves between builds, and one
 * look at one selector is how a parallel shoot produces twenty "no opener
 * matched" failures. The mouse is driven to the element's centre rather than
 * using `locator.click`, which refuses a target it considers hidden.
 */
export const perform = async (page, step) => {
  const hoverOnly = step.startsWith('hover ')
  const selector = hoverOnly ? step.slice('hover '.length) : step
  const union = selector
    .split(/,(?![^[]*\])/)
    .map((s) => s.trim())
    .filter(Boolean)
  for (let attempt = 0; attempt < 20; attempt++) {
    for (const one of union) {
      const box = await page
        .locator(one)
        .first()
        .boundingBox({ timeout: 250 })
        .catch(() => null)
      if (box && box.width && box.height) {
        const x = box.x + box.width / 2
        const y = box.y + box.height / 2
        await page.mouse.move(x, y)
        if (!hoverOnly) await page.mouse.click(x, y)
        return
      }
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`no opener matched: ${step}`)
}

/** Sign in, and return the path the app landed on afterwards (null without auth). */
export const signIn = async (context, side, sideConfig) => {
  const auth = sideConfig.auth ?? { kind: 'none' }
  if (auth.kind === 'none') return null
  const upper = side.toUpperCase()
  const page = await context.newPage()
  /* Warm-up: a freshly started dev server compiles the login route on the first
     request, which can outrun Playwright's default and kill every later capture
     with an error that never mentions login. */
  await page.goto(new URL(auth.path ?? '/login', sideConfig.baseUrl).href, {
    waitUntil: 'domcontentloaded',
    timeout: 120_000,
  })
  if (auth.kind === 'form') {
    const user = await secret(`${sideConfig.baseUrl} username`, `${upper}_USER`)
    const pass = await secret(`${sideConfig.baseUrl} password`, `${upper}_PASS`)
    await page.fill(auth.user, user)
    await page.fill(auth.pass, pass)
    await Promise.all([
      page.waitForLoadState('networkidle').catch(() => {}),
      page.click(auth.submit),
    ])
  } else if (auth.kind === 'token') {
    /* Posted from inside the page, so the cookie the app really uses is set —
       not a header this script invents that no later navigation carries. */
    const token = await secret(`${sideConfig.baseUrl} token`, `${upper}_TOKEN`)
    await page.evaluate(
      async ({ endpoint, body, token }) => {
        await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ ...body, secret: token }),
        })
      },
      { endpoint: auth.endpoint, body: auth.body ?? {}, token },
    )
  } else {
    throw new Error(`unknown auth.kind: ${auth.kind}`)
  }
  await settle(page, sideConfig, auth.settled)
  const landed = new URL(page.url())
  await page.close()
  return landed.origin === new URL(sideConfig.baseUrl).origin ? landed.pathname : null
}
