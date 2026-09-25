/**
 * One rebuild's report, computed from the rows in the database.
 *
 * Shared by `projectReport` (one branch, every row) and `overview` (every
 * branch, summaries only), so the two can never disagree about what counts as
 * scored. See report.function.ts for the two questions a report answers.
 */
import type { Kysely } from 'kysely'
import type { DB } from '#pikku/db/schema.gen.js'

export const buildReport = async (kysely: Kysely<DB>, projectId: string, branchId: string) => {
  /* Every declared coordinate, whether or not anything was ever captured at
     it. Starting from the shots instead would make the report silent about
     exactly the screens the rebuild has not reached — which is half of what
     it is for. */
  const coordinates = await kysely
    .selectFrom('route')
    .innerJoin('routeState', 'routeState.routeId', 'route.routeId')
    .innerJoin('viewport', 'viewport.projectId', 'route.projectId')
    .select([
      'route.routeId as routeId',
      'route.key as routeKey',
      'route.label as routeLabel',
      'route.legacyPath as legacyPath',
      'route.legacyAbsent as legacyAbsent',
      'routeState.stateId as stateId',
      'routeState.key as stateKey',
      'viewport.viewportId as viewportId',
      'viewport.key as viewportKey',
    ])
    .where('route.projectId', '=', projectId)
    .orderBy('route.sort', 'asc')
    .orderBy('routeState.sort', 'asc')
    .orderBy('viewport.sort', 'asc')
    .execute()

  const baselines = await kysely
    .selectFrom('shot')
    .select(['shotId', 'routeId', 'stateId', 'viewportId'])
    .where('projectId', '=', projectId)
    .where('side', '=', 'legacy')
    .where('isBaseline', '=', true)
    .execute()

  const targets = await kysely
    .selectFrom('shot')
    .select(['shotId', 'routeId', 'stateId', 'viewportId'])
    .where('projectId', '=', projectId)
    .where('branchId', '=', branchId)
    .orderBy('capturedAt', 'desc')
    .execute()

  const comparisons = await kysely
    .selectFrom('comparison')
    .select([
      'baselineShotId',
      'targetShotId',
      'status',
      'diffPixels',
      'comparedPixels',
      'diffRatio',
    ])
    .where('projectId', '=', projectId)
    .execute()

  const at = (row: { routeId: string; stateId: string; viewportId: string }) =>
    `${row.routeId}/${row.stateId}/${row.viewportId}`
  const baselineAt = new Map(baselines.map((row) => [at(row), row]))
  /* Most recent wins: `targets` is ordered by capture time descending and the
     first write for a coordinate is kept. */
  const targetAt = new Map<string, (typeof targets)[number]>()
  for (const row of targets) {
    if (!targetAt.has(at(row))) targetAt.set(at(row), row)
  }
  const comparisonAt = new Map(
    comparisons.map((row) => [`${row.baselineShotId}/${row.targetShotId}`, row]),
  )

  const rows = coordinates.map((coordinate) => {
    const baseline = baselineAt.get(at(coordinate))
    const target = targetAt.get(at(coordinate))
    const comparison =
      baseline && target ? comparisonAt.get(`${baseline.shotId}/${target.shotId}`) : undefined

    const base = {
      routeKey: coordinate.routeKey,
      routeLabel: coordinate.routeLabel,
      stateKey: coordinate.stateKey,
      viewportKey: coordinate.viewportKey,
      diffPixels: null as number | null,
      comparedPixels: null as number | null,
      diffRatio: null as number | null,
    }

    if (comparison) {
      return {
        ...base,
        status: comparison.status as 'identical' | 'different' | 'size-mismatch',
        diffPixels: comparison.diffPixels,
        comparedPixels: comparison.comparedPixels,
        diffRatio: comparison.diffRatio,
      }
    }

    /* The order of these three matters. "Legacy does not have this screen" is
       a fact someone asserted; "nobody has mapped it" is an open question; and
       only once neither applies is a missing baseline the story. Collapsing
       them would tell a team it has covered a screen nobody has looked at. */
    if (coordinate.legacyAbsent) return { ...base, status: 'legacy-absent' as const }
    if (!coordinate.legacyPath) return { ...base, status: 'unmapped' as const }
    if (!baseline) return { ...base, status: 'no-baseline' as const }
    return { ...base, status: 'not-built' as const }
  })

  /* Worst first, because the ordering IS the work queue: the screens most
     wrong come first, and the gaps sit behind the scored rows rather than
     interleaved with them. */
  const RANK: Record<string, number> = { different: 0, 'size-mismatch': 1, identical: 2 }
  const rank = (status: string) => RANK[status] ?? 3
  rows.sort((a, b) => rank(a.status) - rank(b.status) || (b.diffRatio ?? 0) - (a.diffRatio ?? 0))

  const count = (status: string) => rows.filter((row) => row.status === status).length
  const identical = count('identical')
  const different = count('different')

  return {
    rows,
    summary: {
      scored: identical + different,
      identical,
      different,
      sizeMismatch: count('size-mismatch'),
      notBuilt: count('not-built'),
      noBaseline: count('no-baseline'),
      legacyAbsent: count('legacy-absent'),
      unmapped: count('unmapped'),
    },
  }
}

export type Report = Awaited<ReturnType<typeof buildReport>>
