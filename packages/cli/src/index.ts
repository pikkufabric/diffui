#!/usr/bin/env bun
/**
 * `diffui` — the command a consuming repo runs, and everything the web app
 * does, from a terminal.
 *
 * Sign up or in, create a project, declare its screens, push screenshots, and
 * read the report back — none of it needs a browser.
 */
import * as commands from './commands.js'
import { init } from './init.js'
import { login } from './login.js'
import { passwordLogin, signup } from './password.js'
import { push } from './push.js'
import { clearSession, loadSession, normaliseServer, sessionPath } from './session.js'

const USAGE = `diffui — visual regression against a legacy app

Account
  diffui signup    --email <email> [--name <name>]
  diffui login     [--email <email>] [--no-browser]
  diffui logout
  diffui whoami

Projects
  diffui projects                       list your projects
  diffui projects create <slug> [--name <name>] [--baseline-label <l>] [--target-label <l>]
  diffui projects show   <project>
  diffui projects delete <project> --yes

Capturing
  diffui init    <routes.json>   --project <project> [--dry-run]
  diffui push    <manifest.json> --project <project> [--branch <key>]
                 [--viewport <key>] [--route <glob>] [--baseline] [--dry-run]

Reading
  diffui overview                       every project's rebuilds at a glance
  diffui routes    --project <project>
  diffui branches  --project <project>
  diffui shots     --project <project> [--route <key>]
  diffui report    --project <project> --branch <key> [--status <status>] [--fail-over <percent>]
  diffui compare   --project <project> --branch <key> --route <key>
                   [--state <key>] [--viewport <key>] [--out <dir>]

  <project>   a project's slug or id
  --server    defaults to $DIFFUI_SERVER, else http://localhost:3300
  --json      print the server's answer as JSON (read commands)
  --route     on push, a glob over screen names, e.g. 'company.*'

  login with --email, and signup, read the password from $DIFFUI_PASSWORD,
  stdin when piped, or a hidden prompt. Without --email, login opens the
  browser device flow. $DIFFUI_API_KEY skips login altogether.
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

  const json = flags.json === true
  const optional = (name: string) =>
    typeof flags[name] === 'string' ? (flags[name] as string) : undefined
  const project = () => asString(flags.project, 'project')
  /* `init` and `push` take a slug too; the server only knows ids. */
  const projectId = async () => (await commands.resolveProject(server, project())).projectId

  switch (command) {
    case 'signup':
      await signup(server, {
        email: asString(flags.email, 'email'),
        ...(optional('name') ? { name: optional('name') } : {}),
      })
      return

    case 'login':
      if (typeof flags.email === 'string') {
        await passwordLogin(server, flags.email)
      } else {
        await login(server, { noBrowser: flags['no-browser'] === true })
      }
      return

    case 'logout':
      /* Local only: the key is forgotten here and expires on its own. Revoking
         it server-side needs a session, which is exactly what is being given
         up. */
      process.stdout.write(
        clearSession(server) ? `Logged out of ${server}.\n` : `Not logged in to ${server}.\n`,
      )
      if (process.env.DIFFUI_API_KEY) {
        process.stdout.write('DIFFUI_API_KEY is still set, and is still used.\n')
      }
      return

    case 'whoami': {
      const session = loadSession(server)
      if (!session) {
        process.stdout.write(`Not logged in to ${server}.\n`)
        process.exitCode = 1
        return
      }
      await commands.whoami(server, json)
      if (json) return
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

    case 'projects':
    case 'project': {
      const [sub, ref] = positionals
      switch (sub) {
        case undefined:
        case 'list':
          return commands.projectsList(server, json)
        case 'create':
          if (!ref) throw new Error('`diffui projects create` needs a slug.')
          return commands.projectsCreate(
            server,
            {
              slug: ref,
              ...(optional('name') ? { name: optional('name') } : {}),
              ...(optional('baseline-label') ? { baselineLabel: optional('baseline-label') } : {}),
              ...(optional('target-label') ? { targetLabel: optional('target-label') } : {}),
            },
            json,
          )
        case 'show':
          return commands.projectsShow(server, ref ?? project(), json)
        case 'delete':
          return commands.projectsDelete(
            server,
            ref ?? project(),
            { yes: flags.yes === true },
            json,
          )
        default:
          throw new Error(`Unknown \`projects ${sub}\`. Try list, create, show or delete.`)
      }
    }

    case 'overview':
      return commands.overview(server, json)

    case 'routes':
      return commands.routes(server, positionals[0] ?? project(), json)

    case 'branches':
      return commands.branches(server, positionals[0] ?? project(), json)

    case 'shots':
      return commands.shots(
        server,
        positionals[0] ?? project(),
        { ...(optional('route') ? { route: optional('route') } : {}) },
        json,
      )

    case 'report': {
      const failOver = optional('fail-over')
      if (failOver !== undefined && Number.isNaN(Number(failOver))) {
        throw new Error('`--fail-over` is a percentage, e.g. 5.')
      }
      return commands.report(
        server,
        positionals[0] ?? project(),
        {
          branch: asString(flags.branch, 'branch'),
          ...(optional('status') ? { status: optional('status') } : {}),
          ...(failOver !== undefined ? { failOver: Number(failOver) } : {}),
        },
        json,
      )
    }

    case 'compare':
      return commands.compare(
        server,
        positionals[0] ?? project(),
        {
          branch: asString(flags.branch, 'branch'),
          route: asString(flags.route, 'route'),
          ...(optional('state') ? { state: optional('state') } : {}),
          ...(optional('viewport') ? { viewport: optional('viewport') } : {}),
          ...(optional('out') ? { out: optional('out') } : {}),
        },
        json,
      )

    case 'init':
      if (!positionals[0]) throw new Error('`diffui init` needs a routes file.')
      await init(server, positionals[0], {
        project: flags['dry-run'] === true ? project() : await projectId(),
        dryRun: flags['dry-run'] === true,
      })
      return

    case 'push':
      if (!positionals[0]) throw new Error('`diffui push` needs a manifest file.')
      await push(server, positionals[0], {
        project: flags['dry-run'] === true ? project() : await projectId(),
        ...(typeof flags.branch === 'string' ? { branch: flags.branch } : {}),
        ...(typeof flags.viewport === 'string' ? { viewport: flags.viewport } : {}),
        ...(typeof flags.route === 'string' ? { route: flags.route } : {}),
        dryRun: flags['dry-run'] === true,
        makeBaseline: flags.baseline === true,
      })
      return

    case 'help':
    case '--help':
    case undefined:
      process.stdout.write(USAGE)
      return

    default:
      process.stdout.write(USAGE)
      process.exitCode = 1
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`\n${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
