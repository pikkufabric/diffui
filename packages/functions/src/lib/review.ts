/**
 * A vision model's reading of one comparison.
 *
 * The pixel diff says THAT a screen differs and by how much; it cannot say
 * WHAT differs, and it ranks a changed timestamp above a missing button
 * (knowledge/decisions/the-diff-is-pixels-only.md). This asks a model to look
 * at the legacy screenshot, the rebuild and the diff, and name each difference
 * — so "3.1% different" becomes "the Export button is missing from the toolbar".
 *
 * It never changes the pixel score. The review is stored beside the comparison
 * (knowledge/decisions/a-model-reads-what-the-pixels-flag.md).
 *
 * The call goes through the injected `agentRunner`, not a vendor SDK: `pikku
 * dev` builds it from OPENAI_BASE_URL/OPENAI_API_KEY and Fabric from its
 * LiteLLM gateway, so the model is a `provider/model` string the gateway
 * resolves and no key lives in this app.
 */
import { z } from 'zod'
import type { AgentRunnerService } from '@pikku/core/services'
import { decodePng, encodePng, type Decoded, type DiffRegion } from './diff.js'

/**
 * The model that reads the screenshots. It has to see images and return
 * schema-shaped JSON, and it must be one the gateway serves: the part after the
 * slash is sent to it as the model name.
 *
 * Gemini Flash, because on Fabric's gateway (ai.pikkufabric.com) it is the
 * cheapest model that does both. Tested there on 2026-09-28: Gemini Flash and
 * Pro and GPT-5 read the screenshots; DeepSeek V4.1 Flash and GLM are text-only
 * through it; Claude and Kimi failed on their accounts' balance. On a real
 * Orders page Flash found the missing button, the renamed column and the row
 * height, but not a button's shade or a changed timestamp — raise this to
 * `google/gemini-pro-latest` if reviews miss things that matter.
 */
export const REVIEW_MODEL = 'google/gemini-flash-latest'

/**
 * Bump when the prompt or the schema changes in a way that makes old reviews
 * incomparable with new ones. `diffui review --force` re-runs stale reviews.
 */
export const REVIEW_PROMPT_VERSION = '1'

export const ReviewSchema = z.object({
  verdict: z.enum(['matches', 'cosmetic', 'functional']),
  summary: z.string(),
  findings: z.array(
    z.object({
      kind: z.enum(['missing', 'added', 'text-changed', 'layout', 'style', 'noise']),
      severity: z.enum(['high', 'medium', 'low']),
      /** Index into the comparison's regions, or null when it is page-wide. */
      region: z.number().int().nullable(),
      description: z.string(),
    }),
  ),
})

export type Review = z.infer<typeof ReviewSchema>

const INSTRUCTIONS = `You review visual regressions between a legacy web app and a rebuild of it.

A team is rebuilding an existing application screen by screen, and the rebuild is finished only when each screen does what the legacy one does and looks close enough that users do not notice. A pixel diff has already flagged this screen as different. Your job is to say WHAT differs, so an engineer can fix it without studying the images themselves.

You receive, in order: the legacy screenshot (the baseline, which is correct by definition), the rebuild's screenshot, the pixel diff, and close-up crops of the regions the diff found, legacy crop first then rebuild crop for each. Each image is preceded by a line saying which it is. A full screenshot too large to send is left out, and then the crops are all you have. In the diff image, red pixels differ, yellow is anti-aliasing and can be ignored, faded grey is unchanged, orange-tinted rows exist only in legacy and green-tinted rows exist only in the rebuild.

Report every difference you can see, one finding each:
- missing: something legacy shows that the rebuild does not — a control, column, field, message, icon or section. These matter most.
- added: something the rebuild shows that legacy does not.
- text-changed: the same element with different wording, labels, numbers or formatting that is not incidental data.
- layout: the same content in a different position, order, size, alignment or spacing.
- style: colour, font, weight, border, shadow, radius or icon style differences.
- noise: differences that come from the data rather than the build — timestamps, dates, generated ids, avatars, random sample data, a blinking cursor. Report them so the team can mask them later, always with low severity.

Severity: high when a user would lose a capability or be misled (a missing action, a wrong label on a button, missing data); medium when a user would notice (a clear layout or style change); low for small visual polish and for all noise.

Set region to the number of the crop the finding appears in (crops are numbered from 0), or null if it is page-wide or you only saw it in the full screenshots.

The verdict: functional if any finding is a missing or changed capability or information a user relies on; cosmetic if everything you found is layout, style or noise; matches if the only differences are noise.

Write the summary as one plain sentence naming the most important difference. Describe elements the way a user would ("the Export button in the table toolbar"), not by coordinates. Do not speculate about code or implementation, and do not report a difference you cannot actually see.`

/** Vendors refuse an image over roughly this many bytes, or over 8000px on a side. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_IMAGE_SIDE = 8000
/** Enough context either side of a region to tell what it is part of. */
const CROP_PADDING = 80
/** Past this the model downscales anyway, and the detail a crop exists for is lost. */
const MAX_CROP_HEIGHT = 1400
/** Largest regions first; the rest are still in the full screenshots. */
const MAX_CROPS = 4

const toBase64 = (bytes: Uint8Array) => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

const fits = (image: Decoded, bytes: Uint8Array) =>
  image.width <= MAX_IMAGE_SIDE &&
  image.height <= MAX_IMAGE_SIDE &&
  Math.ceil(bytes.length / 3) * 4 <= MAX_IMAGE_BYTES

const crop = (image: Decoded, y: number, height: number) => {
  const top = Math.max(0, y - CROP_PADDING)
  const bottom = Math.min(image.height, y + height + CROP_PADDING, top + MAX_CROP_HEIGHT)
  const stride = image.width * 4
  return encodePng(image.width, bottom - top, image.data.subarray(top * stride, bottom * stride))
}

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mediaType: string }

export type ReviewContext = {
  routeLabel: string
  stateKey: string
  viewportKey: string
  diffRatio: number
  regions: DiffRegion[]
}

/**
 * The images and labels for one review, interleaved so each label sits
 * directly before the image it names. Exported for tests.
 */
export const buildReviewContent = async (
  images: { baseline: Uint8Array; target: Uint8Array; diff: Uint8Array | null },
  context: ReviewContext,
) => {
  const baseline = await decodePng(images.baseline)
  const target = await decodePng(images.target)

  const content: ContentPart[] = []
  const label = (text: string) => content.push({ type: 'text', text })
  const image = (bytes: Uint8Array) =>
    content.push({ type: 'image', data: toBase64(bytes), mediaType: 'image/png' })

  /* A full-page capture larger than a vendor accepts is sent only as crops;
     leaving it out is better than failing the review over it. */
  if (fits(baseline, images.baseline)) {
    label('Legacy screenshot (the baseline):')
    image(images.baseline)
  }
  if (fits(target, images.target)) {
    label('Rebuild screenshot:')
    image(images.target)
  }
  if (images.diff) {
    const diff = await decodePng(images.diff)
    if (fits(diff, images.diff)) {
      label('Pixel diff:')
      image(images.diff)
    }
  }

  /* The largest regions, back in page order so crop 0 is the highest. */
  const crops = context.regions
    .map((region, index) => ({ region, index }))
    .sort(
      (a, b) =>
        Math.max(b.region.baseline.height, b.region.target.height) -
        Math.max(a.region.baseline.height, a.region.target.height),
    )
    .slice(0, MAX_CROPS)
    .sort((a, b) => a.index - b.index)

  for (const [n, { region }] of crops.entries()) {
    if (region.baseline.height > 0) {
      label(`Crop ${n} (${region.kind}), legacy, from y=${region.baseline.y}:`)
      image(await crop(baseline, region.baseline.y, region.baseline.height))
    }
    if (region.target.height > 0) {
      label(`Crop ${n} (${region.kind}), rebuild, from y=${region.target.y}:`)
      image(await crop(target, region.target.y, region.target.height))
    }
  }

  label(
    `Screen: ${context.routeLabel}, state "${context.stateKey}", at the ${context.viewportKey} resolution. ` +
      `The pixel diff scored it ${(context.diffRatio * 100).toFixed(2)}% different. Review it.`,
  )

  return { content, crops }
}

export const reviewComparisonImages = async (
  agentRunner: AgentRunnerService,
  images: { baseline: Uint8Array; target: Uint8Array; diff: Uint8Array | null },
  context: ReviewContext,
): Promise<Review> => {
  const { content, crops } = await buildReviewContent(images, context)

  const result = await agentRunner.run({
    model: REVIEW_MODEL,
    instructions: INSTRUCTIONS,
    messages: [{ id: crypto.randomUUID(), role: 'user', content, createdAt: new Date() }],
    tools: [],
    maxSteps: 1,
    toolChoice: 'none',
    outputSchema: z.toJSONSchema(ReviewSchema) as Record<string, unknown>,
  })

  /* The runner asks the model for this shape but does not check what comes
     back (pikkujs/pikku#1823), so it is checked here: a malformed answer fails
     this one review loudly instead of being stored as if it were one. */
  const parsed = ReviewSchema.safeParse(result.object)
  if (!parsed.success) {
    throw new Error(
      `The model's review did not match the expected shape: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`)
        .join('; ')}`,
    )
  }

  /* The model numbers crops; a stored finding points at the comparison's own
     region, so a screen can highlight it on the images. */
  return {
    ...parsed.data,
    findings: parsed.data.findings.map((finding) => ({
      ...finding,
      region: finding.region === null ? null : (crops[finding.region]?.index ?? null),
    })),
  }
}
