import { z } from 'zod'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pikkuScenarioStep } from '#pikku/scenarios'
import { png } from '../lib/png.js'
import { rpcWithDevKey, runCli } from '../lib/cli.js'

export const PushesScreenshotsWithTheCliInput = z.object({})

export const PushesScreenshotsWithTheCliOutput = z.object({
  projectId: z.string(),
  pushed: z.number(),
})

/**
 * The engineer's own path: declare the inventory, push legacy, push a rebuild —
 * all through the `diffui` binary, against the live server.
 *
 * The bindings are alternatives. `default` is the same CLI run, because the
 * subject here IS the command: there is no faster server-side equivalent that
 * would prove anything about the tool. Declaring the `cli` binding keeps the
 * step attributable to the surface it is actually driven on.
 */
const runTheCli = async ({ apiUrl }: { apiUrl: string }) => {
  const stamp = Date.now().toString(36)
  const project = await rpcWithDevKey<{ project: { projectId: string } }>(apiUrl, 'createProject', {
    slug: `cli-${stamp}`,
    name: `CLI ${stamp}`,
  })
  const projectId = project.project.projectId

  const dir = mkdtempSync(join(tmpdir(), 'diffui-cli-'))
  const legacyFile = join(dir, 'legacy.png')
  const rebuildFile = join(dir, 'rebuild.png')
  writeFileSync(legacyFile, png(40, 30))
  writeFileSync(rebuildFile, png(40, 30, { from: 10, to: 20 }))
  writeFileSync(
    join(dir, 'routes.json'),
    JSON.stringify({
      routes: [
        {
          key: 'company.add-user',
          label: 'Add user',
          legacyPath: '/#/admin/users/new',
          states: [{ key: 'default', label: 'Default' }],
        },
      ],
    }),
  )
  writeFileSync(
    join(dir, 'legacy.json'),
    JSON.stringify({
      side: 'legacy',
      shots: [{ route: 'company.add-user', viewport: 'desktop', file: legacyFile }],
    }),
  )
  writeFileSync(
    join(dir, 'rebuild.json'),
    JSON.stringify({
      branch: 'rebuild-1',
      shots: [{ route: 'company.add-user', viewport: 'desktop', file: rebuildFile }],
    }),
  )

  const init = await runCli(
    ['init', join(dir, 'routes.json'), '--project', projectId, '--server', apiUrl],
    dir,
  )
  if (init.code !== 0) {
    throw new Error(`diffui init failed (${init.code}): ${init.stderr || init.stdout}`)
  }

  const legacy = await runCli(
    ['push', join(dir, 'legacy.json'), '--project', projectId, '--server', apiUrl, '--baseline'],
    dir,
  )
  if (legacy.code !== 0) {
    throw new Error(
      `diffui push (legacy) failed (${legacy.code}): ${legacy.stderr || legacy.stdout}`,
    )
  }

  const rebuild = await runCli(
    ['push', join(dir, 'rebuild.json'), '--project', projectId, '--server', apiUrl],
    dir,
  )
  if (rebuild.code !== 0) {
    throw new Error(
      `diffui push (rebuild) failed (${rebuild.code}): ${rebuild.stderr || rebuild.stdout}`,
    )
  }

  /* The CLI's own verdict line is the observable: a rebuild push that reached
     the server and was scored prints `different NN.NN%`; one that only uploaded
     prints `no legacy baseline yet`. */
  if (!legacy.stdout.includes('baseline')) {
    throw new Error(`The legacy push did not report a baseline:\n${legacy.stdout}`)
  }
  if (!rebuild.stdout.includes('different')) {
    throw new Error(`The rebuild push was not scored against the baseline:\n${rebuild.stdout}`)
  }

  return { projectId, pushed: 2 }
}

export const pushesScreenshotsWithTheCli = pikkuScenarioStep({
  name: 'pushesScreenshotsWithTheCli',
  description:
    'declares an inventory and pushes a legacy and a rebuild screenshot with the diffui CLI',
  template: 'pushes the captures with the diffui CLI',
  input: PushesScreenshotsWithTheCliInput,
  output: PushesScreenshotsWithTheCliOutput,
  default: async (_services, _input, { scenarioStep }) => {
    const apiUrl = scenarioStep?.env?.apiUrl
    if (!apiUrl) throw new Error('pushesScreenshotsWithTheCli needs the environment apiUrl.')
    return runTheCli({ apiUrl })
  },
  cli: async (_services, _input, { scenarioStep }) => {
    const apiUrl = scenarioStep?.env?.apiUrl
    if (!apiUrl) throw new Error('pushesScreenshotsWithTheCli needs the environment apiUrl.')
    return runTheCli({ apiUrl })
  },
})
