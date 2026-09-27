/**
 * The model review, against a runner that records what it was sent.
 *
 * No model is called. What is checked is everything around the call that this
 * app owns: that each label sits directly before the image it names, that the
 * crops cover the regions the diff found, that the model's crop numbers are
 * mapped back to the comparison's own regions, and that an answer of the wrong
 * shape is refused rather than stored (pikkujs/pikku#1823 — the runner does not
 * check it).
 *
 * Run: `bun test packages/functions/test/unit`
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import type { AgentRunnerParams, AgentRunnerService } from '@pikku/core/services'
import { decodePng } from '../../src/lib/diff.js'
import { REVIEW_MODEL, buildReviewContent, reviewComparisonImages } from '../../src/lib/review.js'
import { png } from '../lib/png.js'

const baseline = new Uint8Array(png(200, 600))
const target = new Uint8Array(png(200, 600, { from: 300, to: 340 }))

/** Two regions; the SECOND is the larger, so crop numbering differs from region order. */
const regions = [
  { kind: 'changed' as const, baseline: { y: 50, height: 10 }, target: { y: 50, height: 10 } },
  { kind: 'changed' as const, baseline: { y: 300, height: 40 }, target: { y: 300, height: 40 } },
]

const context = {
  routeLabel: 'Orders',
  stateKey: 'default',
  viewportKey: 'desktop',
  diffRatio: 0.0667,
  regions,
}

/** A runner that answers with a fixed object and keeps the params it was called with. */
const fakeRunner = (object: unknown) => {
  const calls: AgentRunnerParams[] = []
  const runner = {
    run: async (params: AgentRunnerParams) => {
      calls.push(params)
      return {
        text: '',
        object,
        toolCalls: [],
        toolResults: [],
        usage: { inputTokens: 0, outputTokens: 0 },
      }
    },
  } as unknown as AgentRunnerService
  return { runner, calls }
}

describe('buildReviewContent', () => {
  test('puts each label directly before the image it names', async () => {
    const { content } = await buildReviewContent({ baseline, target, diff: null }, context)
    const types = content.map((part) => part.type)
    assert.deepEqual(types.slice(0, 4), ['text', 'image', 'text', 'image'])
    assert.equal(types.at(-1), 'text', 'the closing instruction comes last')
    for (let i = 0; i < content.length; i++) {
      if (content[i]!.type === 'image') assert.equal(content[i - 1]!.type, 'text')
    }
  })

  test('crops each region with padding, at full width', async () => {
    const { content, crops } = await buildReviewContent({ baseline, target, diff: null }, context)
    assert.equal(crops.length, 2)
    const images = content.filter((part) => part.type === 'image')
    // two full screenshots, then legacy + rebuild for each of two regions
    assert.equal(images.length, 6)
    const second = await decodePng(
      Uint8Array.from(atob((images[4] as { data: string }).data), (c) => c.charCodeAt(0)),
    )
    assert.equal(second.width, 200)
    assert.equal(second.height, 40 + 80 * 2, 'region height plus padding above and below')
  })
})

describe('reviewComparisonImages', () => {
  test('asks for the review model with a structured-output schema and no tools', async () => {
    const { runner, calls } = fakeRunner({
      verdict: 'cosmetic',
      summary: 'A band moved.',
      findings: [],
    })
    await reviewComparisonImages(runner, { baseline, target, diff: null }, context)
    assert.equal(calls.length, 1)
    assert.equal(calls[0]!.model, REVIEW_MODEL)
    assert.deepEqual(calls[0]!.tools, [])
    assert.ok(calls[0]!.outputSchema, 'without a schema the runner returns free text')
  })

  test("maps the model's crop numbers back to the comparison's regions", async () => {
    /* Five regions and four crops: the smallest (region 0) is dropped, so crop
       0 is region 1, crop 1 is region 2, and so on. */
    const five = [
      { kind: 'changed' as const, baseline: { y: 10, height: 2 }, target: { y: 10, height: 2 } },
      {
        kind: 'changed' as const,
        baseline: { y: 100, height: 20 },
        target: { y: 100, height: 20 },
      },
      {
        kind: 'changed' as const,
        baseline: { y: 200, height: 20 },
        target: { y: 200, height: 20 },
      },
      { kind: 'removed' as const, baseline: { y: 300, height: 40 }, target: { y: 300, height: 0 } },
      { kind: 'added' as const, baseline: { y: 400, height: 0 }, target: { y: 400, height: 30 } },
    ]
    const { runner } = fakeRunner({
      verdict: 'functional',
      summary: 'The toolbar lost its Export button.',
      findings: [
        { kind: 'missing', severity: 'high', region: 1, description: 'Export button' },
        { kind: 'noise', severity: 'low', region: null, description: 'Timestamp' },
      ],
    })
    const review = await reviewComparisonImages(
      runner,
      { baseline, target, diff: null },
      { ...context, regions: five },
    )
    assert.equal(review.findings[0]!.region, 2, 'crop 1 is region 2 once region 0 is dropped')
    assert.equal(review.findings[1]!.region, null)
  })

  test('refuses an answer that does not match the schema', async () => {
    const { runner } = fakeRunner({ verdict: 'probably fine', summary: 'ok', findings: [] })
    await assert.rejects(
      reviewComparisonImages(runner, { baseline, target, diff: null }, context),
      /did not match the expected shape: verdict/,
    )
  })

  test('refuses free text where an object was asked for', async () => {
    const { runner } = fakeRunner(undefined)
    await assert.rejects(
      reviewComparisonImages(runner, { baseline, target, diff: null }, context),
      /did not match the expected shape/,
    )
  })
})
