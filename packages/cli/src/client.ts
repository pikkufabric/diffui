/**
 * The CLI's half of the wire.
 *
 * Plain `fetch` against `POST /rpc/<name>` with `Authorization: Bearer`, which
 * is what the server's better-auth `bearer()` plugin resolves. It does NOT use
 * the generated React/fetch client: that one is built for a browser carrying a
 * cookie, and a CLI has neither a cookie jar nor an origin.
 */
import { loadSession } from './session.js'

export class NotLoggedIn extends Error {}

export const rpc = async <T = unknown>(
  server: string,
  name: string,
  input: unknown,
): Promise<T> => {
  const session = loadSession(server)
  if (!session) {
    throw new NotLoggedIn(`Not logged in to ${server}. Run \`diffui login --server ${server}\`.`)
  }
  if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
    throw new NotLoggedIn(
      `Your login to ${server} expired on ${session.expiresAt}. Run \`diffui login\` again.`,
    )
  }

  const response = await fetch(`${server}/rpc/${name}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      /* `x-api-key`, never `Authorization: Bearer`. The two paths are kept on
         two headers on purpose: bearer is the human session, this is the
         machine credential, and merging them reintroduces the ambiguity the
         split exists to remove. */
      'x-api-key': session.token,
    },
    /* The RPC transport wraps the input: `{ rpcName, data }`. Posting the bare
       input reaches the endpoint and fails schema validation on every field. */
    body: JSON.stringify({ rpcName: name, data: input ?? {} }),
  })

  const body = await response.text()
  if (!response.ok) {
    /* The server's own message is the useful part — "this project declares no
       screen called `x`" tells someone what to fix; "request failed with 500"
       sends them to the server logs for something they could have read here. */
    let message = body
    try {
      message = JSON.parse(body).message ?? body
    } catch {
      /* not JSON; the raw body is the best that is available */
    }
    throw new Error(`${name} failed (${response.status}): ${message}`)
  }

  return body ? (JSON.parse(body) as T) : (undefined as T)
}
