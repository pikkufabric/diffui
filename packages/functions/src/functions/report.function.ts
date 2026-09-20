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

const ImageRef = z.object({
  shotId: z.string(),
  assetUrl: z.string(),
  width: z.number(),
  height: z.number(),
})

export const RouteComparisonInput = z.object({
  projectId: z.string(),
  branchKey: z.string(),
  routeKey: z.string(),
  /** Defaults to the base state and the desktop resolution. */
  stateKey: z.string().optional(),
  viewportKey: z.string().optional(),
})

export const RouteComparisonOutput = z.object({
  routeKey: z.string(),
  routeLabel: z.string(),
  stateKey: z.string(),
  viewportKey: z.string(),
  branchKey: z.string(),
  status: RowStatus,
  diffPixels: z.number().nullable(),
  comparedPixels: z.number().nullable(),
  diffRatio: z.number().nullable(),
  baseline: ImageRef.nullable(),
  target: ImageRef.nullable(),
  diff: z.object({ assetUrl: z.string() }).nullable(),
})

/**
 * The three images behind one number.
 *
 * A percentage tells you a screen is wrong and never how. This reads the pinned
 * legacy shot, the branch shot and the generated difference back by signed URL,
 * so a person can look at what they are being scored on instead of trusting it.
 *
 * The same refusals as the push apply: a state or resolution the project never
 * declared is a miss here, not an empty comparison, because "nobody captured
 * it" and "nobody declared it" are different answers.
 */
export const routeComparison = pikkuFunc({
  expose: true,
  auth: true,
  readonly: true,
  permissions: { canReachProject },
  description: 'One route’s legacy baseline, branch shot and difference, with URLs to see them.',
  input: RouteComparisonInput,
  output: RouteComparisonOutput,
  func: async ({ kysely, content }, input) => {
    if (!content) {
      throw new Error('No content service is available, so a comparison cannot be read back.')
    }

    const branch = await kysely
      .selectFrom('branch')
      .select(['branchId', 'key'])
      .where('projectId', '=', input.projectId)
      .where('key', '=', input.branchKey)
      .executeTakeFirst()
    if (!branch) {
      throw new Error(`This project declares no branch called \`${input.branchKey}\`.`)
    }

    const route = await kysely
      .selectFrom('route')
      .select(['routeId', 'label'])
      .where('projectId', '=', input.projectId)
      .where('key', '=', input.routeKey)
      .executeTakeFirst()
    if (!route) {
      throw new Error(`This project declares no screen called \`${input.routeKey}\`.`)
    }

    const state = await kysely
      .selectFrom('routeState')
      .select('stateId')
      .where('routeId', '=', route.routeId)
      .where('key', '=', input.stateKey ?? 'default')
      .executeTakeFirst()
    if (!state) {
      throw new Error(
        `\`${input.routeKey}\` declares no state called \`${input.stateKey ?? 'default'}\`.`,
      )
    }

    const viewport = await kysely
      .selectFrom('viewport')
      .select('viewportId')
      .where('projectId', '=', input.projectId)
      .where('key', '=', input.viewportKey ?? 'desktop')
      .executeTakeFirst()
    if (!viewport) {
      throw new Error(
        `This project declares no resolution called \`${input.viewportKey ?? 'desktop'}\`.`,
      )
    }

    const baseline = await kysely
      .selectFrom('shot')
      .select(['shotId', 'contentKey', 'width', 'height'])
      .where('projectId', '=', input.projectId)
      .where('routeId', '=', route.routeId)
      .where('stateId', '=', state.stateId)
      .where('viewportId', '=', viewport.viewportId)
      .where('side', '=', 'legacy')
      .where('isBaseline', '=', true)
      .executeTakeFirst()

    const target = await kysely
      .selectFrom('shot')
      .select(['shotId', 'contentKey', 'width', 'height'])
      .where('projectId', '=', input.projectId)
      .where('routeId', '=', route.routeId)
      .where('stateId', '=', state.stateId)
      .where('viewportId', '=', viewport.viewportId)
      .where('branchId', '=', branch.branchId)
      .orderBy('capturedAt', 'desc')
      .executeTakeFirst()

    const comparison =
      baseline && target
        ? await kysely
            .selectFrom('comparison')
            .select(['status', 'diffPixels', 'comparedPixels', 'diffRatio', 'diffContentKey'])
            .where('baselineShotId', '=', baseline.shotId)
            .where('targetShotId', '=', target.shotId)
            .executeTakeFirst()
        : undefined

    const expires = new Date(Date.now() + 60 * 60 * 1000)
    const sign = (bucket: 'shots' | 'diffs', contentKey: string) =>
      content.signContentKey({ bucket, contentKey, dateLessThan: expires })

    const image = async (shot: typeof baseline) =>
      shot
        ? {
            shotId: shot.shotId,
            assetUrl: await sign('shots', shot.contentKey),
            width: shot.width,
            height: shot.height,
          }
        : null

    return {
      routeKey: input.routeKey,
      routeLabel: route.label,
      stateKey: input.stateKey ?? 'default',
      viewportKey: input.viewportKey ?? 'desktop',
      branchKey: branch.key,
      status: (comparison?.status ?? 'not-built') as z.infer<typeof RowStatus>,
      diffPixels: comparison?.diffPixels ?? null,
      comparedPixels: comparison?.comparedPixels ?? null,
      diffRatio: comparison?.diffRatio ?? null,
      baseline: await image(baseline),
      target: await image(target),
      diff: comparison?.diffContentKey
        ? { assetUrl: await sign('diffs', comparison.diffContentKey) }
        : null,
    }
  },
})
