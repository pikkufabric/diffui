/**
 * Where the CLI keeps who it is.
 *
 * `~/.diffui/session.json`, mode 0600, keyed by SERVER URL. Keyed rather than
 * single, because one engineer works against their local stack and a deployed
 * one in the same afternoon, and a single slot makes those two log each other
 * out. The file holds the session token and its expiry — the expiry is what
 * lets `push` say "your login expired" instead of failing with a 401 that reads
 * like the server is broken.
 *
 * This mirrors `pikku login`'s own `~/.pikku/session.json` deliberately. It is a
 * separate file because a diffui credential is not a pikku one, and sharing the
 * file would mean logging out of one tool logs you out of the other.
 */
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export type StoredSession = { token: string; expiresAt: string | null; user?: string }

const sessionFile = () => join(homedir(), '.diffui', 'session.json')

/** Trailing slashes and default ports would otherwise make one server two keys. */
export const normaliseServer = (server: string) => server.replace(/\/+$/, '')

const readAll = (): Record<string, StoredSession> => {
  try {
    return JSON.parse(readFileSync(sessionFile(), 'utf8'))
  } catch {
    return {}
  }
}

export const saveSession = (server: string, session: StoredSession) => {
  const file = sessionFile()
  mkdirSync(dirname(file), { recursive: true })
  const all = readAll()
  all[normaliseServer(server)] = session
  writeFileSync(file, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 })
  /* writeFileSync's mode only applies when it CREATES the file, so an existing
     file keeps whatever permissions it had. Set them explicitly. */
  chmodSync(file, 0o600)
  return file
}

/**
 * `DIFFUI_API_KEY` WINS over anything stored.
 *
 * The device flow needs a human to approve a code in a browser, which is right
 * for an engineer and impossible for a scripted run — so an env var carries a
 * key directly and skips both the flow and the file. Dev seeds ship a known one
 * (`db/sqlite-dev-seed.sql`); CI will want its own, per
 * knowledge/questions/how-should-ci-authenticate.md.
 *
 * It takes precedence rather than filling a gap, so that exporting it overrides
 * a stale stored credential instead of losing to one. The expiry is null because
 * an api key does not carry one the way a session token does: it is revoked, not
 * expired, so there is nothing for `push` to warn about ahead of time.
 */
export const loadSession = (server: string): StoredSession | null => {
  const fromEnv = process.env.DIFFUI_API_KEY
  if (fromEnv) {
    return { token: fromEnv, expiresAt: null, user: 'DIFFUI_API_KEY' }
  }
  return readAll()[normaliseServer(server)] ?? null
}

export const sessionPath = sessionFile
