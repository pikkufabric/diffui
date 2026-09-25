/**
 * The pixel diff, verified against an independent PNG implementation.
 *
 * `lib/diff.ts` carries its own PNG codec because the Worker it runs in has no
 * Node built-ins for an image library to lean on. A hand-written decoder that is
 * wrong by one filter predictor produces a plausible image and a wrong score, and
 * nothing downstream would notice. So every assertion about decoding is made
 * against `pngjs` — a separate, widely used codec — and every assertion about
 * scoring is made against a pixel count worked out by hand from the fixture.
 *
 * Run: `bun test packages/functions/test/unit`
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { deflateSync } from 'node:zlib'
import { PNG, type PNGOptions } from 'pngjs'
import { decodePng, diffScreenshots } from '../../src/lib/diff.js'

type Rgba = [number, number, number, number]
type Paint = (x: number, y: number) => Rgba

/** Paint an image pixel by pixel and encode it with pngjs, in whatever encoding is asked for. */
const encode = (
  width: number,
  height: number,
  paint: Paint,
  options: PNGOptions = {},
): Uint8Array => {
  const image = new PNG({ width, height, ...options })
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = paint(x, y)
      const i = (width * y + x) << 2
      image.data[i] = r
      image.data[i + 1] = g
      image.data[i + 2] = b
      image.data[i + 3] = a
    }
  }
  return new Uint8Array(PNG.sync.write(image, options))
}

/** What pngjs itself reads out of the bytes — the reference the decoder is held to. */
const reference = (bytes: Uint8Array) => {
  const image = PNG.sync.read(Buffer.from(bytes))
  return { width: image.width, height: image.height, data: new Uint8Array(image.data) }
}

/** A gradient with an alpha ramp, so every channel and every filter predictor has work to do. */
const gradient: Paint = (x, y) => [
  (x * 7) & 0xff,
  (y * 11) & 0xff,
  (x * y) & 0xff,
  255 - ((x + y) & 0x7f),
]
const opaque: Paint = (x, y) => {
  const [r, g, b] = gradient(x, y)
  return [r, g, b, 255]
}
const grey: Paint = (x, y) => {
  const v = (x * 13 + y * 5) & 0xff
  return [v, v, v, 255]
}

const solid =
  (color: Rgba): Paint =>
  () =>
    color
const RED: Rgba = [220, 60, 60, 255]
const BLACK: Rgba = [0, 0, 0, 255]

/** A solid image with a band of rows `[from, to)` painted black — the fixture a score is computed from by hand. */
const banded =
  (from: number, to: number): Paint =>
  (_x, y) =>
    y >= from && y < to ? BLACK : RED

// ── PNG construction by hand, for the encodings pngjs cannot write ─────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

const concat = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

const ihdr = (
  width: number,
  height: number,
  bitDepth: number,
  colorType: number,
  interlace = 0,
) => {
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header[8] = bitDepth
  header[9] = colorType
  header[12] = interlace
  return chunk('IHDR', header)
}

/** Every chunk of a PNG, in order, so a test can rewrite one and put the file back together. */
const chunks = (bytes: Uint8Array): { type: string; data: Uint8Array }[] => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const found: { type: string; data: Uint8Array }[] = []
  let offset = 8
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    found.push({ type, data: bytes.subarray(offset + 8, offset + 8 + length) })
    offset += 12 + length
  }
  return found
}

// ── Decoding ───────────────────────────────────────────────────────────────

describe('decodePng agrees with pngjs', () => {
  const cases: { name: string; paint: Paint; options: PNGOptions }[] = [
    { name: 'RGBA (colour type 6)', paint: gradient, options: { colorType: 6 } },
    { name: 'RGB (colour type 2)', paint: opaque, options: { colorType: 2 } },
    { name: 'greyscale (colour type 0)', paint: grey, options: { colorType: 0 } },
    { name: 'greyscale + alpha (colour type 4)', paint: gradient, options: { colorType: 4 } },
  ]

  for (const { name, paint, options } of cases) {
    test(name, async () => {
      const bytes = encode(37, 23, paint, options)
      assert.deepEqual(await decodePng(bytes), reference(bytes))
    })
  }

  /* pngjs picks a filter per scanline by default; pinning each one in turn is
     what proves every predictor — Sub, Up, Average, Paeth — is undone correctly. */
  for (const filterType of [0, 1, 2, 3, 4]) {
    test(`scanline filter ${filterType}`, async () => {
      const bytes = encode(41, 19, gradient, { filterType })
      assert.deepEqual(await decodePng(bytes), reference(bytes))
    })
  }

  test('a palette image, with per-entry transparency from tRNS', async () => {
    const palette = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255])
    const alpha = new Uint8Array([255, 128]) // the third entry has no tRNS value, so it is opaque
    const width = 3
    const height = 2
    const indices = [
      [0, 1, 2],
      [2, 1, 0],
    ]
    const raw = new Uint8Array(indices.flatMap((row) => [0, ...row]))
    const bytes = concat([
      SIGNATURE,
      ihdr(width, height, 8, 3),
      chunk('PLTE', palette),
      chunk('tRNS', alpha),
      chunk('IDAT', new Uint8Array(deflateSync(raw))),
      chunk('IEND', new Uint8Array(0)),
    ])

    const decoded = await decodePng(bytes)
    assert.equal(decoded.width, width)
    assert.equal(decoded.height, height)
    assert.deepEqual(
      [...decoded.data],
      [
        255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255, 0, 0, 255, 255, 0, 255, 0, 128, 255, 0, 0,
        255,
      ],
    )
  })

  test('image data split across several IDAT chunks', async () => {
    const bytes = encode(64, 64, gradient)
    const parts = chunks(bytes)
    const idat = concat(parts.filter((part) => part.type === 'IDAT').map((part) => part.data))
    const third = Math.ceil(idat.length / 3)
    const split = concat([
      SIGNATURE,
      ...parts
        .filter((part) => part.type !== 'IDAT' && part.type !== 'IEND')
        .map((part) => chunk(part.type, part.data)),
      chunk('IDAT', idat.subarray(0, third)),
      chunk('IDAT', idat.subarray(third, third * 2)),
      chunk('IDAT', idat.subarray(third * 2)),
      chunk('IEND', new Uint8Array(0)),
    ])
    assert.deepEqual(await decodePng(split), reference(bytes))
  })

  test('refuses a file that is not a PNG', async () => {
    await assert.rejects(decodePng(new TextEncoder().encode('GIF89a not a png')), /not a PNG/)
  })

  test('refuses a 16-bit PNG by name rather than mis-reading it', async () => {
    const bytes = encode(4, 4, gradient, { bitDepth: 16, colorType: 6, inputHasAlpha: true })
    await assert.rejects(decodePng(bytes), /Only 8-bit PNGs/)
  })

  test('refuses an interlaced PNG by name rather than mis-reading it', async () => {
    const bytes = encode(4, 4, gradient)
    const rewritten = concat([
      SIGNATURE,
      ...chunks(bytes).map((part) => {
        if (part.type !== 'IHDR') return chunk(part.type, part.data)
        const header = new Uint8Array(part.data)
        header[12] = 1 // Adam7
        return chunk('IHDR', header)
      }),
    ])
    await assert.rejects(decodePng(rewritten), /Interlaced PNGs are not supported/)
  })
})

// ── Scoring ────────────────────────────────────────────────────────────────

describe('diffScreenshots', () => {
  test('identical images score zero and say so', async () => {
    const image = encode(120, 80, solid(RED))
    const outcome = await diffScreenshots(image, image)
    assert.equal(outcome.status, 'identical')
    assert.equal(outcome.diffPixels, 0)
    assert.equal(outcome.comparedPixels, 120 * 80)
    assert.equal(outcome.diffRatio, 0)
  })

  test('counts exactly the pixels that changed', async () => {
    // A 10-row band across a 100×50 image: 100 × 10 = 1,000 of 5,000 pixels.
    const baseline = encode(100, 50, solid(RED))
    const target = encode(100, 50, banded(10, 20))
    const outcome = await diffScreenshots(baseline, target)
    assert.equal(outcome.status, 'different')
    assert.equal(outcome.diffPixels, 1000)
    assert.equal(outcome.comparedPixels, 5000)
    assert.equal(outcome.diffRatio, 0.2)
  })

  test('the ratio is the count over the compared pixels, so it can be audited', async () => {
    const outcome = await diffScreenshots(encode(64, 64, solid(RED)), encode(64, 64, banded(0, 16)))
    assert.equal(outcome.diffRatio, outcome.diffPixels / outcome.comparedPixels)
    assert.equal(outcome.diffRatio, 0.25)
  })

  test('is symmetric: legacy against rebuild scores the same as the reverse', async () => {
    const a = encode(90, 60, banded(5, 25))
    const b = encode(90, 60, banded(15, 40))
    const forward = await diffScreenshots(a, b)
    const backward = await diffScreenshots(b, a)
    assert.equal(forward.diffPixels, backward.diffPixels)
    assert.equal(forward.diffRatio, backward.diffRatio)
  })

  test('compares pixels, not bytes: the same picture in another encoding is identical', async () => {
    const asRgba = encode(50, 40, opaque, { colorType: 6, filterType: 0 })
    const asRgb = encode(50, 40, opaque, { colorType: 2, filterType: 4 })
    assert.notDeepEqual(asRgba, asRgb)
    const outcome = await diffScreenshots(asRgba, asRgb)
    assert.equal(outcome.status, 'identical')
    assert.equal(outcome.diffPixels, 0)
  })

  test('ignores a shade too small to see', async () => {
    // One unit on one channel is far below the 0.1 threshold.
    const outcome = await diffScreenshots(
      encode(40, 40, solid([220, 60, 60, 255])),
      encode(40, 40, solid([221, 60, 60, 255])),
    )
    assert.equal(outcome.status, 'identical')
  })

  test('a different width is a different viewport: reported, never resized into a score', async () => {
    const outcome = await diffScreenshots(encode(100, 50, solid(RED)), encode(101, 50, solid(RED)))
    assert.equal(outcome.status, 'size-mismatch')
    assert.equal(outcome.diffImage, null)
    assert.equal(outcome.diffPixels, 0)
    assert.equal(outcome.comparedPixels, 0)
    assert.deepEqual(outcome.regions, [])
  })

  test('a changed band is one changed region, at the same place on both sides', async () => {
    const outcome = await diffScreenshots(
      encode(100, 50, solid(RED)),
      encode(100, 50, banded(10, 20)),
    )
    assert.deepEqual(outcome.regions, [
      { kind: 'changed', baseline: { y: 10, height: 10 }, target: { y: 10, height: 10 } },
    ])
  })

  test('the diff image is a valid PNG that marks exactly the changed region', async () => {
    const width = 30
    const height = 20
    const outcome = await diffScreenshots(
      encode(width, height, solid(RED)),
      encode(width, height, banded(5, 10)),
    )
    assert.ok(outcome.diffImage)

    // Read back by the independent codec, so the encoder is checked too.
    const image = reference(outcome.diffImage)
    assert.equal(image.width, width)
    assert.equal(image.height, height)

    const isMarked = (x: number, y: number) => {
      const i = (y * width + x) * 4
      return image.data[i] === 255 && image.data[i + 1] === 0 && image.data[i + 2] === 0
    }
    let marked = 0
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const inBand = y >= 5 && y < 10
        assert.equal(
          isMarked(x, y),
          inBand,
          `pixel (${x}, ${y}) ${inBand ? 'should' : 'should not'} be marked`,
        )
        if (inBand) marked++
      }
    }
    assert.equal(marked, outcome.diffPixels)
  })
})

// ── Alignment: pages of different heights ─────────────────────────────────

/**
 * A page whose every row is distinct and dense, like a line of text: a
 * pseudo-random pattern seeded by the row's source index, so an alignment has
 * exactly one right answer and pairing a row with the wrong one costs about as
 * much as it would on a real page. `rows` lists which source row each output
 * row draws.
 */
const inked = (x: number, source: number) => {
  let h = Math.imul(x + 1, 0x9e3779b1) ^ Math.imul(source + 1, 0x85ebca77)
  h ^= h >>> 15
  h = Math.imul(h, 0xc2b2ae3d)
  h ^= h >>> 13
  return (h & 3) === 0
}
const page = (width: number, rows: number[]): Uint8Array =>
  encode(width, rows.length, (x, y) =>
    inked(x, rows[y]!) ? [20, 20, 20, 255] : [245, 245, 245, 255],
  )
const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i)

describe('diffScreenshots aligns pages of different heights', () => {
  test('a section the rebuild added counts only its own rows', async () => {
    // Legacy: 60 rows. Rebuild: the same 60, with 10 new ones after row 20.
    const legacy = encode(100, 60, solid(RED))
    const rebuild = encode(100, 70, banded(20, 30))
    const outcome = await diffScreenshots(legacy, rebuild)
    assert.equal(outcome.status, 'different')
    assert.equal(outcome.diffPixels, 10 * 100)
    assert.equal(outcome.comparedPixels, 70 * 100)
    assert.deepEqual(outcome.regions, [
      { kind: 'added', baseline: { y: 20, height: 0 }, target: { y: 20, height: 10 } },
    ])
  })

  test('a section the rebuild dropped is the mirror image', async () => {
    const outcome = await diffScreenshots(
      encode(100, 70, banded(20, 30)),
      encode(100, 60, solid(RED)),
    )
    assert.equal(outcome.diffPixels, 10 * 100)
    assert.equal(outcome.comparedPixels, 70 * 100)
    assert.deepEqual(outcome.regions, [
      { kind: 'removed', baseline: { y: 20, height: 10 }, target: { y: 20, height: 0 } },
    ])
  })

  test('content pushed down scores the rows that moved in and out, not the whole page', async () => {
    // A 5-row header added at the top pushes everything down; a viewport-sized
    // capture then loses legacy's last 5 rows off the bottom.
    const legacy = page(80, range(0, 60))
    const rebuild = page(80, [...range(100, 105), ...range(0, 55)])
    const outcome = await diffScreenshots(legacy, rebuild)
    assert.equal(outcome.comparedPixels, 65 * 80)
    assert.deepEqual(outcome.regions, [
      { kind: 'added', baseline: { y: 0, height: 0 }, target: { y: 0, height: 5 } },
      { kind: 'removed', baseline: { y: 55, height: 5 }, target: { y: 60, height: 0 } },
    ])
    // Only those ten rows' content counts: at most their full width, and the 55
    // rows that merely moved count nothing.
    assert.ok(
      outcome.diffPixels > 0 && outcome.diffPixels <= 10 * 80,
      `diffPixels was ${outcome.diffPixels}`,
    )
  })

  test('a row only one side has costs its content, not its width', async () => {
    // A 10-row card, 20px wide on a 100px page, inserted mid-page.
    const card: Paint = (x, y) => (y >= 20 && y < 30 && x >= 40 && x < 60 ? BLACK : RED)
    const outcome = await diffScreenshots(encode(100, 60, solid(RED)), encode(100, 70, card))
    assert.equal(outcome.diffPixels, 10 * 20)
    assert.equal(outcome.comparedPixels, 70 * 100)
    assert.deepEqual(outcome.regions, [
      { kind: 'added', baseline: { y: 20, height: 0 }, target: { y: 20, height: 10 } },
    ])
  })

  test('a page that only grew empty space costs nothing, but is not identical', async () => {
    const outcome = await diffScreenshots(encode(100, 60, solid(RED)), encode(100, 70, solid(RED)))
    assert.equal(outcome.status, 'different')
    assert.equal(outcome.diffPixels, 0)
    assert.deepEqual(outcome.regions, [
      { kind: 'added', baseline: { y: 60, height: 0 }, target: { y: 60, height: 10 } },
    ])
  })

  test('scores the same in both directions when heights differ', async () => {
    const a = page(80, [...range(0, 30), ...range(200, 212), ...range(30, 60)])
    const b = page(80, [...range(0, 10), ...range(300, 304), ...range(10, 60)])
    const forward = await diffScreenshots(a, b)
    const backward = await diffScreenshots(b, a)
    assert.equal(forward.diffPixels, backward.diffPixels)
    assert.equal(forward.comparedPixels, backward.comparedPixels)
  })

  test('pages too different to align fall back to a top-aligned comparison, and still answer', async () => {
    const legacy = page(80, range(0, 60))
    const rebuild = page(80, [...range(100, 105), ...range(0, 55)])
    const outcome = await diffScreenshots(legacy, rebuild, { maxEdits: 4 })
    assert.equal(outcome.status, 'different')
    // Both are 60 rows tall, so every row is paired top-aligned: one changed
    // region over the whole page, rather than the alignment's added/removed pair.
    assert.equal(outcome.comparedPixels, 60 * 80)
    assert.deepEqual(outcome.regions, [
      { kind: 'changed', baseline: { y: 0, height: 60 }, target: { y: 0, height: 60 } },
    ])
  })

  test('the diff image follows the alignment and tints rows only one side has', async () => {
    const outcome = await diffScreenshots(
      encode(40, 30, solid(RED)),
      encode(40, 36, banded(10, 16)),
    )
    assert.ok(outcome.diffImage)
    const image = reference(outcome.diffImage)
    assert.equal(image.width, 40)
    assert.equal(image.height, 36)
    const at = (x: number, y: number) => [
      ...image.data.subarray((y * 40 + x) * 4, (y * 40 + x) * 4 + 3),
    ]
    const [r, g, b] = at(5, 12) // an added row
    assert.ok(g > r && g > b, `an added row should be tinted green, was rgb(${r}, ${g}, ${b})`)
    const [r2, g2, b2] = at(5, 2) // an unchanged row: pixelmatch's faded grey
    assert.equal(r2, g2)
    assert.equal(g2, b2)
  })

  test('rows that differ only invisibly are not reported as regions', async () => {
    // 16 → 15 on one channel crosses a fingerprint bucket but is far below the
    // pixelmatch threshold: the rows stop matching exactly, yet nothing changed.
    const legacy = encode(60, 40, solid([16, 60, 60, 255]))
    const rebuild = encode(60, 40, (_x, y) =>
      y >= 10 && y < 12 ? [15, 60, 60, 255] : [16, 60, 60, 255],
    )
    const outcome = await diffScreenshots(legacy, rebuild)
    assert.equal(outcome.status, 'identical')
    assert.deepEqual(outcome.regions, [])
  })

  test('changes a few rows apart are reported as one region', async () => {
    const rebuild = encode(100, 60, (_x, y) =>
      (y >= 10 && y < 14) || (y >= 20 && y < 24) ? BLACK : RED,
    )
    const outcome = await diffScreenshots(encode(100, 60, solid(RED)), rebuild)
    assert.equal(outcome.diffPixels, 8 * 100)
    assert.deepEqual(outcome.regions, [
      { kind: 'changed', baseline: { y: 10, height: 14 }, target: { y: 10, height: 14 } },
    ])
  })

  test('a full-page capture a few hundred rows taller aligns in reasonable time', async () => {
    const width = 1200
    const legacyRows = range(0, 3000)
    const rebuildRows = [...range(0, 1000), ...range(5000, 5300), ...range(1000, 3000)]
    const started = performance.now()
    const outcome = await diffScreenshots(page(width, legacyRows), page(width, rebuildRows))
    const took = performance.now() - started
    assert.equal(outcome.comparedPixels, 3300 * width)
    assert.deepEqual(outcome.regions, [
      { kind: 'added', baseline: { y: 1000, height: 0 }, target: { y: 1000, height: 300 } },
    ])
    assert.ok(outcome.diffPixels > 0 && outcome.diffPixels <= 300 * width)
    assert.ok(took < 10_000, `took ${Math.round(took)}ms`)
  })
})
