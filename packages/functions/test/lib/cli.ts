/**
 * Running the real `diffui` binary from a scenario.
 *
 * A scenario step runs in the CLI process, so it can spawn the consuming repo's
 * own command and assert on what it did — which is the only way to prove the
 * CLI's argument parsing, manifest reading and push path work together. The
 * server-side bindings prove the functions; this proves the tool engineers
 * actually run.
 *
 * Authentication is `DIFFUI_API_KEY`, the machine credential the dev seed ships
 * exactly so a scripted run needs no browser (db/sqlite-dev-seed.sql). The key
 * is public, local-only, and owned by a user with no organisation yet — creating
 * a project with it makes one.
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** The dev-only key seeded by `pikku db reset`; never a production credential. */
export const DEV_API_KEY = 'diffui_dev_local_only_0000000000000000'

/** The `diffui` entry, resolved from this file rather than from the cwd. */
export const cliEntry = () =>
  fileURLToPath(new URL('../../../../packages/cli/src/index.ts', import.meta.url))

export type CliRun = { code: number; stdout: string; stderr: string }

/** Spawn the CLI with one command line, carrying the dev credential. */
export const runCli = (args: string[], cwd: string): Promise<CliRun> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliEntry(), ...args], {
      cwd,
      env: { ...process.env, DIFFUI_API_KEY: DEV_API_KEY },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }))
  })

/** One RPC as the machine credential, mirroring the CLI's own wire shape. */
export const rpcWithDevKey = async <T = unknown>(
  apiUrl: string,
  name: string,
  data: unknown,
): Promise<T> => {
  const response = await fetch(`${apiUrl}/rpc/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': DEV_API_KEY },
    body: JSON.stringify({ rpcName: name, data: data ?? {} }),
  })
  if (!response.ok) {
    throw new Error(`${name} refused with ${response.status}: ${await response.text()}`)
  }
  return (await response.json()) as T
}
