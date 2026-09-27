/**
 * Review a rebuild's flagged screens with a vision model.
 *
 * Two steps: find the comparisons that need a review, then review each one in
 * parallel. Each review is its own step, so a restart replays the finished
 * ones from cache and only re-asks the model about the rest — the expensive
 * part is never paid for twice.
 *
 * A failed review is returned by its step rather than thrown
 * (`reviewComparison`), so one screen the model could not read does not fail
 * the run for every other screen.
 */
import { z } from 'zod'
import { pikkuWorkflowFunc } from '#pikku/workflow/pikku-workflow-types.gen.js'
import { ReviewScope } from '../functions/reviews.function.js'

export const ReviewRebuildOutput = z.object({ requested: z.number() })

export const reviewRebuild = pikkuWorkflowFunc({
  description: 'Have a vision model review the screens the pixel diff flagged in one rebuild.',
  tags: ['reviews'],
  input: ReviewScope,
  output: ReviewRebuildOutput,
  func: async (_services, data, { workflow }) => {
    const found = await workflow.do('Find screens to review', 'findComparisonsToReview', data)

    await Promise.all(
      found.comparisonIds.map((comparisonId) =>
        workflow.do(`Review ${comparisonId}`, 'reviewComparison', { comparisonId }),
      ),
    )

    return { requested: found.comparisonIds.length }
  },
})
