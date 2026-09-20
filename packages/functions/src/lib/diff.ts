/**
 * The pixel diff.
 *
 * Pixels only — no DOM, no accessibility tree, no semantic comparison
 * (knowledge/decisions/the-diff-is-pixels-only.md). The question this answers is
 * "does the rebuilt screen LOOK like the one it replaces", and a pixel is the
 * only thing that answers it without an opinion about how either app is built.
 */
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'

export type DiffOutcome =
  | {
      status: 'identical' | 'different'
      diffPixels: number
      comparedPixels: number
      diffRatio: number
      diffImage: Buffer
    }
  | { status: 'size-mismatch'; diffPixels: 0; comparedPixels: 0; diffRatio: 0; diffImage: null }

/**
 * Compare two screenshots.
 *
 * Images of different dimensions are reported as `size-mismatch` and NOT
 * compared. Resizing or padding one to fit the other would manufacture a
 * percentage out of a question nobody has answered — and a rebuild rendering at
 * the wrong viewport would score respectably instead of reporting the actual
 * problem, which is that it is the wrong size.
 *
 * The threshold is pixelmatch's own default. Anti-aliasing detection is left on
 * so that a font rendered a shade differently by the same browser does not read
 * as a changed screen.
 */
export const diffScreenshots = (baseline: Buffer, target: Buffer): DiffOutcome => {
  const a = PNG.sync.read(baseline)
  const b = PNG.sync.read(target)

  if (a.width !== b.width || a.height !== b.height) {
    return {
      status: 'size-mismatch',
      diffPixels: 0,
      comparedPixels: 0,
      diffRatio: 0,
      diffImage: null,
    }
  }

  const diff = new PNG({ width: a.width, height: a.height })
  const diffPixels = pixelmatch(a.data, b.data, diff.data, a.width, a.height, {
    threshold: 0.1,
    includeAA: false,
  })

  /* `comparedPixels` is returned and stored alongside the count so the
     percentage is auditable: a reader can divide the two themselves rather than
     taking the ratio on trust. */
  const comparedPixels = a.width * a.height
  return {
    status: diffPixels === 0 ? 'identical' : 'different',
    diffPixels,
    comparedPixels,
    diffRatio: comparedPixels === 0 ? 0 : diffPixels / comparedPixels,
    diffImage: PNG.sync.write(diff),
  }
}
