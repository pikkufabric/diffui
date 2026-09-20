/**
 * `diffui login` — the device authorization flow (RFC 8628).
 *
 * The CLI runs in a consuming repo on an engineer's machine or in CI. It has no
 * browser of its own and must never hold a password, so it asks the server for
 * a short code, the engineer approves that code in a browser they are already
 * signed into, and the CLI polls until the server hands it a session token.
 *
 * This is the same flow and the same shape as `pikku login`, which is the
 * precedent here. Nothing about the credential is invented by this file: the
 * token is better-auth's own session token, and it travels as
 * `Authorization: Bearer` because the server enables better-auth's `bearer()`
 * plugin. There is no diffui token format.
 */
import { spawn } from 'node:child_process'
import { hostname } from 'node:os'
import { normaliseServer, saveSession, type StoredSession } from './session.js'

const CLIENT_ID = 'diffui-cli'

type DeviceCode = {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete?: string
  expires_in: number
  interval: number
}

const openBrowser = (url: string) => {
  const opener =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  try {
    spawn(opener, [url], { stdio: 'ignore', detached: true }).unref()
  } catch {
    /* No browser to open is normal on a server, and the URL is already printed. */
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Mint the key this machine will present from now on.
 *
 * Named after the host so that a person looking at their keys can tell which
 * machine each one is, and revoke the laptop they lost without revoking CI.
 */
const mintApiKey = async (server: string, sessionToken: string) => {
  const name = `diffui-cli:${hostname()}`
  const response = await fetch(`${server}/api/auth/api-key/create`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${sessionToken}`,
      origin: server,
    },
    body: JSON.stringify({
      name,
      /* 90 days. Long enough not to be a weekly chore, short enough that a key
         copied off a machine does not work forever. */
      expiresIn: 60 * 60 * 24 * 90,
      metadata: { client: 'diffui-cli', host: hostname() },
    }),
  })
  if (!response.ok) {
    throw new Error(
      `Signed in, but ${server} would not issue a CLI key (${response.status}): ${await response.text()}\n` +
        `The server must enable better-auth's apiKey() plugin.`,
    )
  }
  const key = (await response.json()) as { key: string; expiresAt?: string | null }
  if (!key.key) throw new Error('The server issued a key with no value.')
  return { key: key.key, expiresAt: key.expiresAt ?? null, name }
}

export const login = async (rawServer: string, options: { noBrowser?: boolean } = {}) => {
  const server = normaliseServer(rawServer)

  const codeResponse = await fetch(`${server}/api/auth/device/code`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, scope: 'openid' }),
  })
  if (!codeResponse.ok) {
    throw new Error(
      `${server} would not start a device login (${codeResponse.status}): ${await codeResponse.text()}\n` +
        `The server must enable better-auth's deviceAuthorization() and bearer() plugins.`,
    )
  }
  const device = (await codeResponse.json()) as DeviceCode

  const verify = device.verification_uri_complete ?? device.verification_uri
  process.stdout.write(
    `\nTo finish signing in, open:\n\n  ${verify}\n\nand confirm the code:  ${device.user_code}\n\n`,
  )
  if (!options.noBrowser) openBrowser(verify)

  /* The server sets the polling interval and the CLI obeys it. Polling faster
     than asked is what gets a client `slow_down`-ed and then rate-limited. */
  let interval = (device.interval || 5) * 1000
  const deadline = Date.now() + (device.expires_in || 300) * 1000

  while (Date.now() < deadline) {
    await sleep(interval)

    const tokenResponse = await fetch(`${server}/api/auth/device/token`, {
      method: 'POST',
      /* JSON, not the form encoding RFC 8628 specifies: this server's HTTP
         layer parses JSON bodies and answers 415 to a form-encoded one. The
         field names stay the OAuth ones, because that is what the endpoint
         reads. */
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: device.device_code,
        client_id: CLIENT_ID,
      }),
    })
    const payload = (await tokenResponse.json().catch(() => ({}))) as Record<string, unknown>

    if (tokenResponse.ok && typeof payload.access_token === 'string') {
      /* Trade the session for a machine key.
       *
       * The session token only resolves on better-auth's own routes, so it
       * could not call a single diffui function. `POST /api/auth/api-key/create`
       * IS one of better-auth's own routes, which is why the bearer works here
       * and nowhere else. What gets stored is the key. */
      const apiKey = await mintApiKey(server, payload.access_token)
      const session: StoredSession = {
        token: apiKey.key,
        expiresAt: apiKey.expiresAt,
        user: apiKey.name,
      }
      const file = saveSession(server, session)
      process.stdout.write(`Signed in to ${server}.\nCredential stored at ${file} (0600).\n`)
      return session
    }

    const error = payload.error
    if (error === 'authorization_pending') continue
    if (error === 'slow_down') {
      interval += 5000
      continue
    }
    throw new Error(
      `Device login failed: ${String(error ?? tokenResponse.status)} ${String(payload.error_description ?? '')}`.trim(),
    )
  }

  throw new Error('The code expired before it was approved. Run `diffui login` again.')
}
