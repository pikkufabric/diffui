import { z } from 'zod'
import { pikkuScenarioStep } from '#pikku/scenarios'
import { session } from '../lib/browser-vocabulary.js'

export const SeesImageInput = z.object({
  /** The testid on the element wrapping, or rendered as, the image. */
  testId: z.string(),
})

export const SeesImageOutput = z.object({
  testId: z.string(),
})

/**
 * Wait for an image on the page to actually load.
 *
 * `seesText` cannot make this claim: an `<img>` whose `src` 404s or whose signed
 * URL was refused is still a visible element with nothing in it. Waiting for
 * `naturalWidth > 0` is what proves the bytes came back, which is the whole
 * point of a milestone about screenshots landing.
 *
 * The image may be the located element itself or a child of it — Mantine's
 * `Image` wraps one — so the `img` is looked for inside first and the element
 * itself is the fallback.
 */
export const seesImage = pikkuScenarioStep({
  name: 'seesImage',
  description: 'waits for an image on the current page to load',
  template: 'sees the image {testId}',
  input: SeesImageInput,
  output: SeesImageOutput,
  browser: async (_services, { testId }, { browser }) => {
    const actor = session(browser)
    const located = actor.locate({ testId })
    await located.waitFor({ state: 'visible' })

    const nested = located.locator('img').first()
    const candidate = (await nested.count()) > 0 ? nested : located
    await candidate.waitFor({ state: 'visible' })

    try {
      await candidate.evaluate(
        (element) =>
          new Promise<void>((resolve, reject) => {
            const image = element as HTMLImageElement
            if (image.tagName !== 'IMG') {
              reject(new Error('the element is not an image and contains none'))
              return
            }
            if (image.complete) {
              if (image.naturalWidth > 0) resolve()
              else reject(new Error('the image loaded with zero width — its URL was refused'))
              return
            }
            image.addEventListener('load', () => resolve(), { once: true })
            image.addEventListener('error', () => reject(new Error('the image failed to load')), {
              once: true,
            })
          }),
      )
    } catch (error) {
      throw new Error(
        `The image \`${testId}\` did not load: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }

    return { testId }
  },
})
