/**
 * The report.
 *
 * It answers two questions and keeps them apart
 * (knowledge/decisions/design/the-report-answers-two-questions.md):
 *
 *   1. How far is this rebuild from legacy, on the screens both sides have?
 *   2. What is missing — screens legacy has that the rebuild has never pushed,
 *      and screens nobody has mapped either way?
 *
 * Merging them produces the number that makes a rebuild look finished: a branch
 * that has pushed three of two hundred screens and matched them perfectly is
 * not 100% done, and a single percentage cannot say so.
 */
import { z } from 'zod'
import { pikkuFunc } from '#pikku/function'
import { canReachProject } from '../permissions.js'

const RowStatus = z.enum([
  /** Both sides captured; the pixels agree. */
  'identical',
  /** Both sides captured; the pixels differ. */
  'different',
  /** Both sides captured at different sizes — never scored, never resized. */
  'size-mismatch',
  /** Legacy has a baseline here; this rebuild has pushed nothing. */
  'not-built',
  /** Legacy genuinely does not have this screen, so there is nothing to match. */
  'legacy-absent',
  /** Nobody has mapped this screen on the legacy side yet. An open question. */
  'unmapped',
  /** Mapped, but legacy has never been captured here, so there is no baseline. */
  'no-baseline',
])

export const ProjectReportInput = z.object({
  projectId: z.string(),
  branchKey: z.string(),
})

export const ProjectReportOutput = z.object({
  branch: z.object({ key: z.string(), label: z.string() }),
  rows: z.array(
    z.object({
      routeKey: z.string(),
      routeLabel: z.string(),
      stateKey: z.string(),
      viewportKey: z.string(),
      status: RowStatus,
      diffPixels: z.number().nullable(),
      comparedPixels: z.number().nullable(),
      diffRatio: z.number().nullable(),
    }),
  ),
  /**
   * Counts, never a single score. `scored` is the denominator for `identical`
   * and `different`; `notBuilt` and the three unanswered kinds are deliberately
   * NOT folded into it, because they are not a percentage of anything.
   */
  summary: z.object({
    scored: z.number(),
    identical: z.number(),
    different: z.number(),
    sizeMismatch: z.number(),
    notBuilt: z.number(),
    noBaseline: z.number(),
    legacyAbsent: z.number(),
    unmapped: z.number(),
  }),
})

export const projectReport = pikkuFunc({
  expose: true,
  auth: true,
  readonly: true,
  permissions: { canReachProject },
  description: 'How far one rebuild is from legacy, and what it has not covered.',
  input: ProjectReportInput,
  output: ProjectReportOutput,
  func: async ({ kysely }, input) => {
    const branch = await kysely
      .selectFrom('branch')
      .select(['branchId', 'key', 'label'])
      .where('projectId', '=', input.projectId)
      .where('key', '=', input.branchKey)
      .executeTakeFirst()
    if (!branch) {
      throw new Error(`This project declares no branch called \`${input.branchKey}\`.`)
    }

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
      .where('route.projectId', '=', input.projectId)
      .orderBy('route.sort', 'asc')
      .orderBy('routeState.sort', 'asc')
      .orderBy('viewport.sort', 'asc')
      .execute()

    const baselines = await kysely
      .selectFrom('shot')
      .select(['shotId', 'routeId', 'stateId', 'viewportId'])
      .where('projectId', '=', input.projectId)
      .where('side', '=', 'legacy')
      .where('isBaseline', '=', true)
      .execute()

    const targets = await kysely
      .selectFrom('shot')
      .select(['shotId', 'routeId', 'stateId', 'viewportId'])
      .where('projectId', '=', input.projectId)
      .where('branchId', '=', branch.branchId)
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
      .where('projectId', '=', input.projectId)
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

    const count = (status: string) => rows.filter((row) => row.status === status).length
    const identical = count('identical')
    const different = count('different')

    return {
      branch: { key: branch.key, label: branch.label },
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
  },
})
