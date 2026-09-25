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
import { buildReport } from '../lib/report.js'

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

    return {
      branch: { key: branch.key, label: branch.label },
      ...(await buildReport(kysely, input.projectId, branch.branchId)),
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
  /**
   * Where the pages differ in structure: stretches of rows that changed, that
   * only legacy has, or that only this rebuild has, with the y-range on each
   * image. Empty when the rows lined up one-for-one.
   */
  regions: z.array(
    z.object({
      kind: z.enum(['changed', 'added', 'removed']),
      baseline: z.object({ y: z.number(), height: z.number() }),
      target: z.object({ y: z.number(), height: z.number() }),
    }),
  ),
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
            .select([
              'status',
              'diffPixels',
              'comparedPixels',
              'diffRatio',
              'diffContentKey',
              'regions',
            ])
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
      regions: comparison ? JSON.parse(comparison.regions) : [],
    }
  },
})
