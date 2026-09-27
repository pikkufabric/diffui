/**
 * `diffui login --email` and `diffui signup` — signing in with no browser.
 *
 * The device flow (`login.ts`) needs a browser somewhere that is already signed
 * in, which is exactly what a person working only in a terminal does not have —
 * and cannot get without an account, which is the other thing a browser was
 * needed for. These two commands close that gap with better-auth's own
 * email-and-password routes.
 *
 * They end where the device flow ends: the session token is traded for a
 * machine key (`storeKeyFor`) and only the key is stored. The password is never
 * written anywhere.
 */
import { storeKeyFor } from './login.js'
import { normaliseServer } from './session.js'

/**
 * Read a password without echoing it.
 *
 * `DIFFUI_PASSWORD` wins, for scripts. A piped stdin is read as-is, for
 * `--password-stdin`-style use. Otherwise the terminal is put in raw mode and
 * nothing typed is written back.
 */
const readPassword = async (prompt: string): Promise<string> => {
  if (process.env.DIFFUI_PASSWORD) return process.env.DIFFUI_PASSWORD

  const stdin = process.stdin
  if (!stdin.isTTY) {
    const chunks: Buffer[] = []
    for await (const chunk of stdin) chunks.push(chunk as Buffer)
    const value = Buffer.concat(chunks)
      .toString('utf8')
      .replace(/\r?\n$/, '')
    if (!value) throw new Error('No password on stdin. Set DIFFUI_PASSWORD or pipe one in.')
    return value
  }

  process.stdout.write(prompt)
  stdin.setRawMode(true)
  stdin.resume()
  stdin.setEncoding('utf8')

  return new Promise((resolve, reject) => {
    let value = ''
    const done = (error?: Error) => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.off('data', onData)
      process.stdout.write('\n')
      if (error) reject(error)
      else resolve(value)
    }
    const onData = (input: string) => {
      for (const char of input) {
        if (char === '\r' || char === '\n') return done()
        if (char === '\u0003') return done(new Error('Cancelled.'))
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1)
        else value += char
      }
    }
    stdin.on('data', onData)
  })
}

/** POST to a better-auth route and hand back the session token it issued. */
const authCall = async (server: string, path: string, body: unknown, action: string) => {
  const response = await fetch(`${server}/api/auth/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: server },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let payload: Record<string, unknown> = {}
  try {
    payload = JSON.parse(text)
  } catch {
    /* not JSON; the raw text goes in the error below */
  }
  if (!response.ok) {
    throw new Error(`${action} failed (${response.status}): ${String(payload.message ?? text)}`)
  }
  /* `bearer()` hands the token back in a header; the body carries it too. */
  const token = response.headers.get('set-auth-token') ?? payload.token
  if (typeof token !== 'string' || !token) {
    throw new Error(
      `${action} succeeded but ${server} issued no session token — it may require email verification first.`,
    )
  }
  return token
}

export const passwordLogin = async (rawServer: string, email: string) => {
  const server = normaliseServer(rawServer)
  const password = await readPassword(`Password for ${email}: `)
  const token = await authCall(server, 'sign-in/email', { email, password }, 'Sign-in')
  return storeKeyFor(server, token)
}

export const signup = async (rawServer: string, options: { email: string; name?: string }) => {
  const server = normaliseServer(rawServer)
  const password = await readPassword('Choose a password: ')
  if (!process.env.DIFFUI_PASSWORD && process.stdin.isTTY) {
    const again = await readPassword('Again: ')
    if (again !== password) throw new Error('The two passwords do not match.')
  }
  const token = await authCall(
    server,
    'sign-up/email',
    { email: options.email, password, name: options.name ?? options.email.split('@')[0] },
    'Sign-up',
  )
  return storeKeyFor(server, token)
}
