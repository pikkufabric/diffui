/**
 * `diffui init <routes.json>` — push the screen inventory.
 *
 * The inventory is a FILE IN THE CONSUMING REPO, reviewed like code, because
 * the list of screens a rebuild is chasing is a statement about the product and
 * belongs where the product is discussed. This command only carries it over.
 *
 * Idempotent by construction: `declareRoutes` upserts on (project, key), and
 * the key is the screen's identity. Running it twice changes nothing the second
 * time — proven rather than asserted, by comparing what comes back.
 */
import { readFileSync } from 'node:fs'
import { rpc } from './client.js'

type RouteFile = {
  routes: Array<{
    key: string
    label: string
    /** Where legacy has this screen. Absent means "nobody has mapped it yet". */
    legacyPath?: string | null
    newPath?: string | null
    /**
     * Legacy genuinely does not have this screen.
     *
     * This is the distinction the whole report hangs on: `legacyAbsent: true` is
     * a claim somebody made, and a missing `legacyPath` is an open question.
     * They are NOT the same and this file must keep them apart — see
     * db/sqlite/0007-project-and-routes.sql.
     */
    legacyAbsent?: boolean
    states?: Array<{ key: string; label: string; ref?: string | null }>
  }>
}

export const init = async (
  server: string,
  file: string,
  options: { project: string; dryRun?: boolean },
) => {
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as RouteFile
  if (!Array.isArray(parsed.routes) || parsed.routes.length === 0) {
    throw new Error(`${file} declares no routes.`)
  }

  for (const route of parsed.routes) {
    if (route.legacyAbsent && route.legacyPath) {
      throw new Error(
        `\`${route.key}\` says legacy both lacks the screen and has it at \`${route.legacyPath}\`. One of the two is wrong.`,
      )
    }
  }

  if (options.dryRun) {
    process.stdout.write(`Would declare ${parsed.routes.length} screens on ${options.project}:\n`)
    for (const route of parsed.routes) {
      const legacy = route.legacyAbsent ? 'legacy lacks it' : (route.legacyPath ?? 'not mapped yet')
      const states = route.states?.length ? route.states.map((s) => s.key).join(', ') : 'default'
      process.stdout.write(`  ${route.key}  [${legacy}]  states: ${states}\n`)
    }
    return { declared: 0, dryRun: true }
  }

  const result = await rpc<{ declared: number; routes: unknown[] }>(server, 'declareRoutes', {
    projectId: options.project,
    routes: parsed.routes,
  })

  process.stdout.write(
    `Declared ${result.declared} screens on ${options.project} (${result.routes.length} now tracked).\n`,
  )
  return result
}
