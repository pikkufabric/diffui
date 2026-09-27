/**
 * Reviews — a model's reading of the screens the pixel diff flagged.
 *
 * `requestReview` is the door: the web app or `diffui review` asks for one
 * rebuild's flagged screens to be reviewed, and it starts the `reviewRebuild`
 * workflow (wirings/reviews.workflow.ts). The two sessionless functions below
 * are that workflow's steps and are not exposed.
 *
 * Only `different` comparisons are reviewed — identical ones have nothing to
 * explain and size mismatches were never compared — and only the latest
 * capture of each screen against the current baseline, so a stale pair is
 * never paid for. See knowledge/decisions/a-model-reads-what-the-pixels-flag.md.
 */
import { z } from 'zod'
import type { Kysely } from 'kysely'
import type { DB } from '#pikku/db/schema.gen.js'
import { pikkuFunc, pikkuSessionlessFunc } from '#pikku/function'
import { canReachProject } from '../permissions.js'
import {
  REVIEW_MODEL,
  REVIEW_PROMPT_VERSION,
  reviewComparisonImages,
  type Review,
} from '../lib/review.js'

/** Ceiling per run. The worst screens come first, so the cap drops the least different. */
const DEFAULT_LIMIT = 25
const MAX_LIMIT = 200

export const ReviewScope = z.object({
  projectId: z.string(),
  branchKey: z.string(),
  /** One screen only. */
  routeKey: z.string().optional(),
  limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
  /** Review again even where a current review exists. */
  force: z.boolean().optional(),
})

/**
 * The comparisons in scope that need a review, worst first.
 *
 * "Need" is: no review yet, a failed one, or one written by a different model
 * or prompt. `force` drops that condition.
 */
const comparisonsToReview = async (kysely: Kysely<DB>, scope: z.infer<typeof ReviewScope>) => {
  const branch = await kysely
    .selectFrom('branch')
    .select('branchId')
    .where('projectId', '=', scope.projectId)
    .where('key', '=', scope.branchKey)
    .executeTakeFirst()
  if (!branch) {
    throw new Error(`This project declares no branch called \`${scope.branchKey}\`.`)
  }

  const rows = await kysely
    .selectFrom('comparison')
    .innerJoin('shot as target', 'target.shotId', 'comparison.targetShotId')
    .innerJoin('shot as baseline', 'baseline.shotId', 'comparison.baselineShotId')
    .innerJoin('route', 'route.routeId', 'target.routeId')
    .leftJoin('comparisonReview', 'comparisonReview.comparisonId', 'comparison.comparisonId')
    .select('comparison.comparisonId')
    .where('comparison.projectId', '=', scope.projectId)
    .where('comparison.status', '=', 'different')
    .where('target.branchId', '=', branch.branchId)
    .where('baseline.isBaseline', '=', true)
    /* The latest capture of this screen on this branch — an older pair is
       history, and reviewing it would pay for an answer nobody reads. */
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom('shot as newer')
            .select('newer.shotId')
            .whereRef('newer.routeId', '=', 'target.routeId')
            .whereRef('newer.stateId', '=', 'target.stateId')
            .whereRef('newer.viewportId', '=', 'target.viewportId')
            .whereRef('newer.branchId', '=', 'target.branchId')
            .whereRef('newer.capturedAt', '>', 'target.capturedAt'),
        ),
      ),
    )
    .$if(scope.routeKey !== undefined, (query) => query.where('route.key', '=', scope.routeKey!))
    .$if(!scope.force, (query) =>
      query.where((eb) =>
        eb.or([
          eb('comparisonReview.comparisonId', 'is', null),
          eb('comparisonReview.status', '=', 'failed'),
          eb('comparisonReview.model', '!=', REVIEW_MODEL),
          eb('comparisonReview.promptVersion', '!=', REVIEW_PROMPT_VERSION),
        ]),
      ),
    )
    .orderBy('comparison.diffRatio', 'desc')
    .limit(scope.limit ?? DEFAULT_LIMIT)
    .execute()

  return rows.map((row) => row.comparisonId)
}

export const FindComparisonsToReviewOutput = z.object({ comparisonIds: z.array(z.string()) })

export const findComparisonsToReview = pikkuSessionlessFunc({
  description:
    'The flagged comparisons in one rebuild that still need a model review, worst first.',
  input: ReviewScope,
  output: FindComparisonsToReviewOutput,
  func: async ({ kysely }, input) => ({
    comparisonIds: await comparisonsToReview(kysely, input),
  }),
})

export const ReviewComparisonInput = z.object({ comparisonId: z.string() })

export const ReviewComparisonOutput = z.object({
  status: z.enum(['done', 'failed']),
  verdict: z.enum(['matches', 'cosmetic', 'functional']).nullable(),
})

/**
 * Review one comparison and store the result.
 *
 * Idempotent: the row is keyed by comparison, so a retried step overwrites
 * rather than duplicates. A model or image failure is RECORDED as a failed
 * review and returned, not thrown — one unreadable screen must not fail the
 * run for the other forty, and `failed` is what makes the next run retry it.
 */
export const reviewComparison = pikkuSessionlessFunc({
  description: 'Have a vision model review one flagged comparison, and store what it found.',
  input: ReviewComparisonInput,
  output: ReviewComparisonOutput,
  func: async ({ kysely, content, agentRunner, logger }, { comparisonId }) => {
    const row = await kysely
      .selectFrom('comparison')
      .innerJoin('shot as baseline', 'baseline.shotId', 'comparison.baselineShotId')
      .innerJoin('shot as target', 'target.shotId', 'comparison.targetShotId')
      .innerJoin('route', 'route.routeId', 'target.routeId')
      .innerJoin('routeState', 'routeState.stateId', 'target.stateId')
      .innerJoin('viewport', 'viewport.viewportId', 'target.viewportId')
      .select([
        'comparison.projectId',
        'comparison.diffRatio',
        'comparison.diffContentKey',
        'comparison.regions',
        'baseline.contentKey as baselineKey',
        'target.contentKey as targetKey',
        'route.label as routeLabel',
        'routeState.key as stateKey',
        'viewport.key as viewportKey',
      ])
      .where('comparison.comparisonId', '=', comparisonId)
      .executeTakeFirstOrThrow()

    /* Keyed by comparison, so a retried step overwrites rather than duplicates. */
    const record = async (
      outcome: { status: 'done'; review: Review } | { status: 'failed'; error: string },
    ) => {
      const values = {
        status: outcome.status,
        verdict: outcome.status === 'done' ? outcome.review.verdict : null,
        summary: outcome.status === 'done' ? outcome.review.summary : null,
        findings: outcome.status === 'done' ? JSON.stringify(outcome.review.findings) : '[]',
        error: outcome.status === 'failed' ? outcome.error : null,
        model: REVIEW_MODEL,
        promptVersion: REVIEW_PROMPT_VERSION,
        createdAt: new Date().toISOString(),
      }
      await kysely
        .insertInto('comparisonReview')
        .values({ comparisonId, projectId: row.projectId, ...values })
        .onConflict((oc) => oc.column('comparisonId').doUpdateSet(values))
        .execute()
    }

    try {
      if (!agentRunner) {
        throw new Error(
          'No AI runner on this server. Locally, set OPENAI_BASE_URL and OPENAI_API_KEY for `pikku dev`.',
        )
      }
      if (!content) {
        throw new Error('No content service is available, so the screenshots cannot be read.')
      }
      const [baseline, target, diff] = await Promise.all([
        content.readFileAsBuffer({ bucket: 'shots', key: row.baselineKey }),
        content.readFileAsBuffer({ bucket: 'shots', key: row.targetKey }),
        row.diffContentKey
          ? content.readFileAsBuffer({ bucket: 'diffs', key: row.diffContentKey })
          : Promise.resolve(null),
      ])

      const review = await reviewComparisonImages(
        agentRunner,
        { baseline, target, diff },
        {
          routeLabel: row.routeLabel,
          stateKey: row.stateKey,
          viewportKey: row.viewportKey,
          diffRatio: row.diffRatio,
          regions: JSON.parse(row.regions),
        },
      )

      await record({ status: 'done', review })
      return { status: 'done' as const, verdict: review.verdict }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(`Review of comparison ${comparisonId} failed: ${message}`)
      await record({ status: 'failed', error: message })
      return { status: 'failed' as const, verdict: null }
    }
  },
})

export const RequestReviewOutput = z.object({
  /** Null when nothing needed a review, so no run was started. */
  runId: z.string().nullable(),
  screens: z.number(),
})

/**
 * Ask for a rebuild's flagged screens to be reviewed.
 *
 * Counts first, so a request with nothing to do says so instead of starting an
 * empty run, and the caller learns how many screens are being paid for.
 */
export const requestReview = pikkuFunc({
  expose: true,
  auth: true,
  permissions: { canReachProject },
  description: 'Have a vision model review the screens the pixel diff flagged in one rebuild.',
  input: ReviewScope,
  output: RequestReviewOutput,
  func: async ({ kysely, agentRunner }, input, { rpc }) => {
    if (!agentRunner) {
      throw new Error(
        'Screen review is not available on this server: no AI runner is configured. ' +
          'Locally, set OPENAI_BASE_URL and OPENAI_API_KEY for `pikku dev`.',
      )
    }

    const screens = (await comparisonsToReview(kysely, input)).length
    if (screens === 0) return { runId: null, screens: 0 }

    const { runId } = await rpc.startWorkflow('reviewRebuild', input)
    return { runId, screens }
  },
})
