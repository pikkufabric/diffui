// Local dev runner: the API (pikku) and the frontend (vite) together.
//
// Three things this handles that a plain `bun run` cannot:
//  - `.env` is parsed HERE and passed explicitly to both children. The pikku CLI
//    has a node shebang, so bun's implicit .env loading never reaches it, and
//    Better Auth then fails sign-up with an opaque "Requested secret not found".
//  - The per-project secrets are generated on first run. A committed one would be
//    the same secret in every scaffold; a missing one breaks sign-in.
//  - The dev-only "Sign in as …" switcher's env is baked from the generated
//    personas. A hosted sandbox dev server does that for you; this script starts
//    vite itself, so it has to do it here.
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = resolve(root, '.env')

// A missing BETTER_AUTH_SECRET is a 500 on the first sign-up; a missing
// SCENARIO_ACTOR_SECRET disables /api/auth/sign-in/actor, which fails every scenario
// at sign-in and hides the "Sign in as …" switcher (it renders nothing without a
// secret). Appended rather than written once, so a project scaffolded before one of
// these was added here still picks it up.
const generatedSecrets = ['BETTER_AUTH_SECRET', 'SCENARIO_ACTOR_SECRET']

if (!existsSync(envPath)) {
  writeFileSync(
    envPath,
    [
      '# Local development only — this file is gitignored and never deployed.',
      '# Deployed stages get their own secrets injected by the platform.',
      '',
    ].join('\n'),
  )
}

let envFile = readFileSync(envPath, 'utf8')
if (envFile.length > 0 && !envFile.endsWith('\n')) envFile += '\n'
const missingSecrets = generatedSecrets.filter(
  (name) => !new RegExp(`^\\s*${name}\\s*=`, 'm').test(envFile),
)
if (missingSecrets.length > 0) {
  envFile += `${missingSecrets.map((name) => `${name}=${randomBytes(32).toString('base64')}`).join('\n')}\n`
  writeFileSync(envPath, envFile)
  console.log(`dev: generated ${missingSecrets.join(', ')} in .env`)
}

const env = { ...process.env }
for (const line of envFile.split('\n')) {
  const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
  if (!match) continue
  const value = match[2].trim().replace(/^["']|["']$/g, '')
  env[match[1]] ??= value
}

// The login screen's "Sign in as …" switcher reads its actor list and one credential
// per actor from VITE_* vars — without them it renders null and the only way into a
// local session is a password the synthetic persona users do not have. The addresses
// are read from pikku's generated meta rather than re-derived from the persona id
// and `scenarios.emailDomain`, because the dev seed creates the user rows from that
// same file and a second derivation is drift waiting to happen.
const personasPath = resolve(root, 'packages/functions/.pikku/workflow/personas.gen.json')
const readDevActors = () => {
  if (!existsSync(personasPath)) return ''
  try {
    const personas = JSON.parse(readFileSync(personasPath, 'utf8'))
    return JSON.stringify(
      Object.values(personas)
        // `runnable: false` is the persona only ever acted UPON (the account an admin
        // bans) — offering them invites a sign-in that races the scenario.
        .filter((persona) => persona.runnable !== false && persona.email)
        .map(({ id, email, name, jobTitle }) => ({
          key: id,
          email,
          name,
          jobTitle: jobTitle ?? '',
        })),
    )
  } catch (error) {
    console.warn(`dev: could not read personas: ${error.message}`)
    return ''
  }
}

// One credential per persona, derived from the root and refused for any other
// address, so the browser bundle never holds the root that is entitled to all of them.
const mintDevActorSecrets = async (rootSecret, actorsJson) => {
  if (!rootSecret || !actorsJson) return ''
  try {
    const { deriveActorSecret } = await import('@pikku/core/services')
    const secrets = {}
    for (const actor of JSON.parse(actorsJson)) {
      secrets[actor.email] = await deriveActorSecret(rootSecret, actor.email)
    }
    return JSON.stringify(secrets)
  } catch (error) {
    console.warn(`dev: could not mint persona credentials: ${error.message}`)
    return ''
  }
}

env.VITE_DEV_ACTORS = readDevActors()
delete env.VITE_SCENARIO_ACTOR_SECRET
env.VITE_DEV_ACTOR_SECRETS = await mintDevActorSecrets(
  env.SCENARIO_ACTOR_SECRET,
  env.VITE_DEV_ACTORS,
)

// `--bun` is load-bearing: the pikku CLI has a `#!/usr/bin/env node` shebang, so a
// node on PATH is used even under bunx. The CLI opens the local database with
// `node:sqlite`, which node only ships unflagged from 24 — on anything older this
// dies with `ERR_UNKNOWN_BUILTIN_MODULE: No such built-in module: node:sqlite`.
// `--bun` ignores the shebang and runs it on bun, which has that module.
const spawnApi = () =>
  spawn('bunx', ['--bun', 'pikku', 'dev'], { cwd: root, env, stdio: 'inherit' })
const spawnFrontend = () =>
  spawn('bun', ['run', '--filter', '@project/app', 'dev'], { cwd: root, env, stdio: 'inherit' })

// One child dying takes the whole dev session with it — a half-running stack
// (frontend up, API down) looks like an app bug and wastes debugging time.
const children = []
let shuttingDown = false
const shutdown = (code) => {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) child.kill('SIGTERM')
  process.exit(code)
}

const supervise = (child) => {
  child.on('exit', (code) => shutdown(code ?? 0))
  child.on('error', (err) => {
    console.error(`dev: failed to start a process: ${err.message}`)
    shutdown(1)
  })
  return child
}

children.push(supervise(spawnApi()), supervise(spawnFrontend()))

// `.pikku` is gitignored, so on a fresh scaffold the personas do not exist until
// `pikku dev` has finished its first codegen — by which time vite has baked an empty
// actor list, and vite reads import.meta.env exactly once, at boot. So the list is
// watched and the frontend restarted, rather than leaving a whole dev session whose
// switcher is silently empty.
const restartFrontend = () => {
  const previous = children[1]
  // Detach first, or a deliberate kill reads as a crash and takes the API down with
  // it; wait for the exit, because vite holds its port until the process is gone.
  previous.removeAllListeners('exit')
  previous.removeAllListeners('error')
  previous.once('exit', () => {
    if (shuttingDown) return
    children[1] = supervise(spawnFrontend())
  })
  previous.kill('SIGTERM')
}

const personaWatch = setInterval(async () => {
  if (shuttingDown) return
  const actors = readDevActors()
  if (actors === env.VITE_DEV_ACTORS) return
  env.VITE_DEV_ACTORS = actors
  env.VITE_DEV_ACTOR_SECRETS = await mintDevActorSecrets(env.SCENARIO_ACTOR_SECRET, actors)
  if (shuttingDown) return
  console.log('dev: personas changed — restarting the frontend to rebake the actor switcher')
  restartFrontend()
}, 2000)
personaWatch.unref()

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
