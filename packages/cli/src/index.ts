#!/usr/bin/env bun
/**
 * `diffui` — the command a consuming repo runs.
 *
 * Three commands: sign in, declare the screens being tracked, push the
 * screenshots. Everything else diffui does happens on the server.
 */
import { init } from './init.js'
import { login } from './login.js'
import { push } from './push.js'
import { loadSession, normaliseServer, sessionPath } from './session.js'

const USAGE = `diffui — visual regression against a legacy app

  diffui login   [--server <url>] [--no-browser]
  diffui init    <routes.json>  --project <id> [--dry-run]
  diffui push    <manifest.json> --project <id> [--branch <key>]
                 [--viewport <key>] [--route <glob>] [--baseline] [--dry-run]
  diffui whoami  [--server <url>]

  --server    defaults to $DIFFUI_SERVER, else http://localhost:3300
  --project   the project id these screens belong to
  --route     a glob over screen names, e.g. 'company.*'
`

/** A deliberately small parser: flags, their values, and positionals. */
const parseArgs = (argv: string[]) => {
  const flags: Record<string, string | true> = {}
  const positionals: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (!arg.startsWith('--')) {
      positionals.push(arg)
      continue
    }
    const name = arg.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      flags[name] = next
      i++
    } else {
      flags[name] = true
    }
  }
  return { flags, positionals }
}

const asString = (value: string | true | undefined, flag: string) => {
  if (typeof value !== 'string') {
    throw new Error(`\`--${flag}\` needs a value.`)
  }
  return value
}

const main = async () => {
  const [command, ...rest] = process.argv.slice(2)
  const { flags, positionals } = parseArgs(rest)

  const server = normaliseServer(
    typeof flags.server === 'string'
      ? flags.server
      : (process.env.DIFFUI_SERVER ?? 'http://localhost:3300'),
  )

  switch (command) {
    case 'login':
      await login(server, { noBrowser: flags['no-browser'] === true })
      return

    case 'whoami': {
      const session = loadSession(server)
      if (!session) {
        process.stdout.write(`Not logged in to ${server}.\n`)
        process.exitCode = 1
        return
      }
      /* Name the credential ACTUALLY in use. Reporting `session.json` while
         authenticating from DIFFUI_API_KEY sends anyone debugging a permission
         problem to the wrong file — and the env var deliberately beats the
         stored one, so the two disagree exactly when it matters most. */
      const fromEnv = session.user === 'DIFFUI_API_KEY'
      process.stdout.write(
        `Logged in to ${server}${session.expiresAt ? ` until ${session.expiresAt}` : ''}.\n` +
          `Credential: ${fromEnv ? 'DIFFUI_API_KEY (environment)' : sessionPath()}\n`,
      )
      return
    }

    case 'init':
      if (!positionals[0]) throw new Error('`diffui init` needs a routes file.')
      await init(server, positionals[0], {
        project: asString(flags.project, 'project'),
        dryRun: flags['dry-run'] === true,
      })
      return

    case 'push':
      if (!positionals[0]) throw new Error('`diffui push` needs a manifest file.')
      await push(server, positionals[0], {
        project: asString(flags.project, 'project'),
        ...(typeof flags.branch === 'string' ? { branch: flags.branch } : {}),
        ...(typeof flags.viewport === 'string' ? { viewport: flags.viewport } : {}),
        ...(typeof flags.route === 'string' ? { route: flags.route } : {}),
        dryRun: flags['dry-run'] === true,
        makeBaseline: flags.baseline === true,
      })
      return

    default:
      process.stdout.write(USAGE)
      process.exitCode = command ? 1 : 0
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`\n${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
