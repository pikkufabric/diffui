/**
 * The pixel diff.
 *
 * Pixels only — no DOM, no accessibility tree, no semantic comparison
 * (knowledge/decisions/the-diff-is-pixels-only.md). The question this answers is
 * "does the rebuilt screen LOOK like the one it replaces", and a pixel is the
 * only thing that answers it without an opinion about how either app is built.
 *
 * No image library. This runs inside a Cloudflare Worker on Fabric, where Node
 * built-ins an image library reaches for (`node:util`, `node:zlib`, `node:stream`)
 * are not available — `pngjs` bundles to a dynamic `require("node:util")` the
 * Worker rejects at publish. So the PNG codec is here: inflate/deflate through
 * the standard `DecompressionStream`/`CompressionStream` the platform provides,
 * and the handful of PNG rules it takes to turn IDAT bytes into RGBA and back.
 * `pixelmatch` is plain ECMAScript and stays.
 */
import pixelmatch from 'pixelmatch'

/**
 * A stretch of rows the alignment could not match one-for-one.
 *
 * `changed`: rows on both sides at the same place in the page, compared pixel
 * for pixel. `removed`: rows only legacy has — a section the rebuild dropped.
 * `added`: rows only the rebuild has. Each carries its y-range on BOTH images,
 * because the two pages scroll differently once one of them grows; a zero
 * height means the section is absent on that side.
 */
export type DiffRegion = {
  kind: 'changed' | 'added' | 'removed'
  baseline: { y: number; height: number }
  target: { y: number; height: number }
}

export type DiffOutcome =
  | {
      status: 'identical' | 'different'
      diffPixels: number
      comparedPixels: number
      diffRatio: number
      diffImage: Uint8Array
      regions: DiffRegion[]
    }
  | {
      status: 'size-mismatch'
      diffPixels: 0
      comparedPixels: 0
      diffRatio: 0
      diffImage: null
      regions: []
    }

export type DiffOptions = {
  /** pixelmatch's per-pixel colour threshold, 0–1. Lower is stricter. */
  threshold?: number
  /** Count anti-aliased pixels as different. Off: a font smoothed a shade differently is not a change. */
  includeAA?: boolean
  /**
   * The most row insertions + deletions the alignment will search for before
   * giving up and comparing the unmatched middle top-aligned. Bounds memory:
   * the search keeps roughly `maxEdits²` integers.
   */
  maxEdits?: number
}

export type Decoded = { width: number; height: number; data: Uint8Array }

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

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
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const concat = (parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** A one-chunk Web stream, so the byte array never needs a Node `Readable`. */
const streamFrom = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })

const readStream = async (stream: ReadableStream<Uint8Array>): Promise<Uint8Array> => {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) chunks.push(value)
  }
  return concat(chunks)
}

/**
 * The compression streams are typed over `BufferSource`, which the generic
 * `Uint8Array<ArrayBufferLike>` a Buffer arrives as does not satisfy. They are
 * byte-in / byte-out regardless, so the shape is stated here once.
 */
const inflate = (bytes: Uint8Array): Promise<Uint8Array> =>
  readStream(
    streamFrom(bytes).pipeThrough(
      new DecompressionStream('deflate') as unknown as TransformStream<Uint8Array, Uint8Array>,
    ),
  )

const deflate = (bytes: Uint8Array): Promise<Uint8Array> =>
  readStream(
    streamFrom(bytes).pipeThrough(
      new CompressionStream('deflate') as unknown as TransformStream<Uint8Array, Uint8Array>,
    ),
  )

/**
 * Undo the per-scanline filters and return the channel bytes.
 *
 * Every PNG row is stored as one filter byte followed by its pixels, each byte
 * predicted from the pixel to the left (`a`), above (`b`) or above-left (`c`).
 * The predictors are the only part of the format that cannot be skipped, so they
 * are here; a raw (filter 0) image falls out unchanged.
 */
const unfilter = (raw: Uint8Array, width: number, height: number, channels: number): Uint8Array => {
  const stride = width * channels
  const out = new Uint8Array(stride * height)
  let pos = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++]!
    const row = y * stride
    const prev = (y - 1) * stride
    for (let x = 0; x < stride; x++) {
      const byte = raw[pos++]!
      const a = x >= channels ? out[row + x - channels]! : 0
      const b = y > 0 ? out[prev + x]! : 0
      const c = y > 0 && x >= channels ? out[prev + x - channels]! : 0
      let value: number
      switch (filter) {
        case 0:
          value = byte
          break
        case 1:
          value = byte + a
          break
        case 2:
          value = byte + b
          break
        case 3:
          value = byte + ((a + b) >> 1)
          break
        case 4: {
          const p = a + b - c
          const pa = Math.abs(p - a)
          const pb = Math.abs(p - b)
          const pc = Math.abs(p - c)
          value = byte + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
          break
        }
        default:
          throw new Error(`Unsupported PNG filter type ${filter}.`)
      }
      out[row + x] = value & 0xff
    }
  }
  return out
}

/**
 * Decode a PNG to 8-bit RGBA.
 *
 * Deliberately narrow: 8-bit, non-interlaced, the color types a screenshot
 * tool emits. Anything else is refused by name rather than mis-read, because a
 * silently wrong image is a silently wrong diff score.
 */
export const decodePng = async (bytes: Uint8Array): Promise<Decoded> => {
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error('That file is not a PNG.')
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  let palette: Uint8Array | null = null
  let transparency: Uint8Array | null = null
  const idat: Uint8Array[] = []

  let offset = 8
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!,
    )
    const start = offset + 8
    if (type === 'IHDR') {
      width = view.getUint32(start)
      height = view.getUint32(start + 4)
      bitDepth = bytes[start + 8]!
      colorType = bytes[start + 9]!
      interlace = bytes[start + 12]!
    } else if (type === 'PLTE') {
      palette = bytes.subarray(start, start + length)
    } else if (type === 'tRNS') {
      transparency = bytes.subarray(start, start + length)
    } else if (type === 'IDAT') {
      idat.push(bytes.subarray(start, start + length))
    } else if (type === 'IEND') {
      break
    }
    offset = start + length + 4
  }

  if (bitDepth !== 8) {
    throw new Error(`Only 8-bit PNGs are supported for a diff; this one is ${bitDepth}-bit.`)
  }
  if (interlace !== 0) {
    throw new Error('Interlaced PNGs are not supported for a diff.')
  }

  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1
  const pixels = unfilter(await inflate(concat(idat)), width, height, channels)
  const data = new Uint8Array(width * height * 4)

  for (let i = 0; i < width * height; i++) {
    const o = i * 4
    if (colorType === 6) {
      data[o] = pixels[i * 4]!
      data[o + 1] = pixels[i * 4 + 1]!
      data[o + 2] = pixels[i * 4 + 2]!
      data[o + 3] = pixels[i * 4 + 3]!
    } else if (colorType === 2) {
      data[o] = pixels[i * 3]!
      data[o + 1] = pixels[i * 3 + 1]!
      data[o + 2] = pixels[i * 3 + 2]!
      data[o + 3] = 255
    } else if (colorType === 0) {
      const grey = pixels[i]!
      data[o] = grey
      data[o + 1] = grey
      data[o + 2] = grey
      data[o + 3] = 255
    } else if (colorType === 4) {
      const grey = pixels[i * 2]!
      data[o] = grey
      data[o + 1] = grey
      data[o + 2] = grey
      data[o + 3] = pixels[i * 2 + 1]!
    } else if (colorType === 3) {
      if (!palette) throw new Error('Palette PNG has no PLTE chunk.')
      const index = pixels[i]!
      data[o] = palette[index * 3]!
      data[o + 1] = palette[index * 3 + 1]!
      data[o + 2] = palette[index * 3 + 2]!
      data[o + 3] = transparency && index < transparency.length ? transparency[index]! : 255
    } else {
      throw new Error(`Unsupported PNG color type ${colorType}.`)
    }
  }

  return { width, height, data }
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

/** Encode 8-bit RGBA as a non-interlaced PNG (filter 0, zlib IDAT). */
const encodePng = async (width: number, height: number, data: Uint8Array): Promise<Uint8Array> => {
  const stride = width * 4
  const raw = new Uint8Array((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    raw.set(data.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1)
  }

  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA
  header[10] = 0 // compression
  header[11] = 0 // filter
  header[12] = 0 // non-interlaced

  return concat([
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', await deflate(raw)),
    chunk('IEND', new Uint8Array(0)),
  ])
}

/**
 * A fingerprint per row, coarse on purpose.
 *
 * Only the ALIGNMENT reads these — every aligned row pair is still compared by
 * pixelmatch — so the fingerprint only has to say "this is probably the same
 * row". Dropping the low four bits of each channel lets a row that rendered a
 * shade differently still line up with its counterpart, instead of breaking a
 * long matched run into a hunk.
 */
const rowFingerprints = (image: Decoded): Uint32Array => {
  const out = new Uint32Array(image.height)
  const stride = image.width * 4
  for (let y = 0; y < image.height; y++) {
    let hash = 0x811c9dc5
    const row = y * stride
    for (let i = 0; i < stride; i++) {
      hash ^= image.data[row + i]! >> 4
      hash = Math.imul(hash, 0x01000193)
    }
    out[y] = hash >>> 0
  }
  return out
}

type Op = { type: 'match' | 'removed' | 'added'; b: number; t: number }

/**
 * Myers' O((N+M)·D) diff over row fingerprints — the algorithm behind a text
 * diff, with a screenshot's rows as its lines.
 *
 * Returns the edit script from `a` (legacy) to `b` (the rebuild), or `null` when
 * the two need more than `maxEdits` insertions and deletions to reconcile, which
 * means they share too little structure for an alignment to mean anything.
 */
const myers = (a: Uint32Array, b: Uint32Array, maxEdits: number): Op[] | null => {
  const n = a.length
  const m = b.length
  const limit = Math.min(n + m, maxEdits)
  const offset = limit + 1
  const v = new Int32Array(2 * limit + 3)
  /* trace[d] holds v for k in [-(d-1), d-1] as it stood BEFORE step d — the
     slice backtracking reads. Keeping only that window, not all of v, is what
     holds memory to ~D² rather than D·(N+M). */
  const trace: Int32Array[] = []

  let found = -1
  for (let d = 0; d <= limit && found < 0; d++) {
    trace.push(d === 0 ? new Int32Array(0) : v.slice(offset - (d - 1), offset + d))
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)
          ? v[offset + k + 1]!
          : v[offset + k - 1]! + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[offset + k] = x
      if (x >= n && y >= m) {
        found = d
        break
      }
    }
  }
  if (found < 0) return null

  const ops: Op[] = []
  let x = n
  let y = m
  for (let d = found; d > 0; d--) {
    const prev = trace[d]!
    const at = (k: number) => prev[k + (d - 1)]!
    const k = x - y
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1))
    const prevK = down ? k + 1 : k - 1
    const prevX = at(prevK)
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      x--
      y--
      ops.push({ type: 'match', b: x, t: y })
    }
    if (down) {
      y--
      ops.push({ type: 'added', b: -1, t: y })
    } else {
      x--
      ops.push({ type: 'removed', b: x, t: -1 })
    }
  }
  while (x > 0 && y > 0) {
    x--
    y--
    ops.push({ type: 'match', b: x, t: y })
  }
  return ops.reverse()
}

type Row =
  | { kind: 'pair'; b: number; t: number }
  | { kind: 'removed'; b: number }
  | { kind: 'added'; t: number }

/**
 * Line the rows of the two images up.
 *
 * The common head and tail are matched first — a header and a footer that did
 * not change are most of most pages, and stripping them keeps the search to
 * the part that did. Inside a hunk (a run of removals and additions between two
 * matches) the rows are paired top-down: the rebuild's version of a section
 * sits where legacy's did, so its pixels are compared rather than both being
 * written off. Only the rows one side has more of are left unpaired.
 */
const align = (a: Uint32Array, b: Uint32Array, maxEdits: number): Row[] => {
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++
  }

  const midA = a.subarray(head, a.length - tail)
  const midB = b.subarray(head, b.length - tail)
  const middle: Op[] = myers(midA, midB, maxEdits) ?? [
    // Too different to align: one hunk, which pairs top-aligned below.
    ...Array.from(midA, (_, i) => ({ type: 'removed' as const, b: i, t: -1 })),
    ...Array.from(midB, (_, i) => ({ type: 'added' as const, b: -1, t: i })),
  ]

  const ops: Op[] = []
  for (let i = 0; i < head; i++) ops.push({ type: 'match', b: i, t: i })
  for (const op of middle) {
    ops.push({ type: op.type, b: op.b < 0 ? -1 : op.b + head, t: op.t < 0 ? -1 : op.t + head })
  }
  for (let i = tail; i > 0; i--) ops.push({ type: 'match', b: a.length - i, t: b.length - i })

  const rows: Row[] = []
  let i = 0
  while (i < ops.length) {
    const op = ops[i]!
    if (op.type === 'match') {
      rows.push({ kind: 'pair', b: op.b, t: op.t })
      i++
      continue
    }
    const removed: number[] = []
    const added: number[] = []
    while (i < ops.length && ops[i]!.type !== 'match') {
      if (ops[i]!.type === 'removed') removed.push(ops[i]!.b)
      else added.push(ops[i]!.t)
      i++
    }
    const paired = Math.min(removed.length, added.length)
    for (let p = 0; p < paired; p++) rows.push({ kind: 'pair', b: removed[p]!, t: added[p]! })
    for (let p = paired; p < removed.length; p++) rows.push({ kind: 'removed', b: removed[p]! })
    for (let p = paired; p < added.length; p++) rows.push({ kind: 'added', t: added[p]! })
  }
  return rows
}

/** Row i against row i, and whatever one side has beyond the other's height. */
const topAligned = (heightA: number, heightB: number): Row[] => {
  const rows: Row[] = []
  for (let y = 0; y < Math.min(heightA, heightB); y++) rows.push({ kind: 'pair', b: y, t: y })
  for (let y = heightB; y < heightA; y++) rows.push({ kind: 'removed', b: y })
  for (let y = heightA; y < heightB; y++) rows.push({ kind: 'added', t: y })
  return rows
}

/**
 * The page's background: its most common colour, sampled. A row only one side
 * has is scored against a row of this, so what it costs is the content in it —
 * a strip of empty page costs nothing, a card costs the card.
 */
const backgroundOf = (image: Decoded): Uint8Array => {
  const counts = new Map<number, number>()
  const pixels = image.width * image.height
  const step = Math.max(1, Math.floor(pixels / 20_000))
  const view = new DataView(image.data.buffer, image.data.byteOffset, image.data.byteLength)
  let best = 0
  let bestCount = -1
  for (let i = 0; i < pixels; i += step) {
    const colour = view.getUint32(i * 4)
    const count = (counts.get(colour) ?? 0) + 1
    counts.set(colour, count)
    if (count > bestCount) {
      best = colour
      bestCount = count
    }
  }
  return new Uint8Array([best >>> 24, (best >>> 16) & 0xff, (best >>> 8) & 0xff, best & 0xff])
}

/** How many pixels of these rows stand out from a page background. */
const contentPixels = (
  image: Decoded,
  ys: number[],
  background: Uint8Array,
  options: { threshold: number; includeAA: boolean },
) => {
  if (ys.length === 0) return 0
  const stride = image.width * 4
  const rows = new Uint8Array(ys.length * stride)
  ys.forEach((y, i) => rows.set(image.data.subarray(y * stride, y * stride + stride), i * stride))
  const blank = new Uint8Array(ys.length * stride)
  for (let x = 0; x < blank.length; x += 4) blank.set(background, x)
  return pixelmatch(rows, blank, undefined, image.width, ys.length, options)
}

/**
 * Score one pairing of rows: every paired row compared in one pixelmatch pass
 * over two images built from those rows alone, stacked in alignment order.
 * A row only one side has costs its content — every pixel that stands out from
 * that page's background — so a missing card is scored as the card, not as a
 * full-width stripe of which most was empty page.
 */
const evaluate = (
  a: Decoded,
  b: Decoded,
  backgrounds: { a: Uint8Array; b: Uint8Array },
  rows: Row[],
  options: { threshold: number; includeAA: boolean },
) => {
  const width = a.width
  const stride = width * 4
  const pairs = rows.filter((row): row is Extract<Row, { kind: 'pair' }> => row.kind === 'pair')
  const stackedA = new Uint8Array(pairs.length * stride)
  const stackedB = new Uint8Array(pairs.length * stride)
  pairs.forEach((row, i) => {
    stackedA.set(a.data.subarray(row.b * stride, row.b * stride + stride), i * stride)
    stackedB.set(b.data.subarray(row.t * stride, row.t * stride + stride), i * stride)
  })
  const stackedDiff = new Uint8Array(pairs.length * stride)
  const paired =
    pairs.length === 0
      ? 0
      : pixelmatch(stackedA, stackedB, stackedDiff, width, pairs.length, options)
  const removed = rows.flatMap((row) => (row.kind === 'removed' ? [row.b] : []))
  const added = rows.flatMap((row) => (row.kind === 'added' ? [row.t] : []))
  return {
    rows,
    stackedDiff,
    unpaired: removed.length + added.length,
    diffPixels:
      paired +
      contentPixels(a, removed, backgrounds.a, options) +
      contentPixels(b, added, backgrounds.b, options),
  }
}

/** pixelmatch's own faded-greyscale rendering of an unchanged pixel. */
const fade = (r: number, g: number, b: number) =>
  255 + (r * 0.29889531 + g * 0.58662247 + b * 0.11448223 - 255) * 0.1

/** Rows only legacy has are tinted orange; rows only the rebuild has, green. */
const REMOVED_TINT = [255, 140, 0] as const
const ADDED_TINT = [0, 170, 90] as const

/** Rows closer than this, of the same kind, are reported as one region — about
    two lines of body text, so a paragraph whose lines each moved reads as one. */
const MERGE_GAP = 48

/**
 * The regions, read off the rows as scored rather than off the alignment.
 *
 * A paired row is part of a `changed` region only if pixelmatch found a real
 * difference in it (painted pure red — anti-aliasing is yellow, unchanged is
 * faded grey). So a section shifted by a fraction of a pixel, whose every text
 * line fingerprints differently but looks the same, reports nothing. Runs of
 * the same kind a few rows apart are merged, so a changed card is one region
 * rather than one per line of text in it.
 */
const regionsOf = (
  rows: Row[],
  stackedDiff: Uint8Array,
  stride: number,
  heightA: number,
  heightB: number,
): DiffRegion[] => {
  /* The row each side is at, per aligned row, so a region absent on one side
     can say where it would have been: before that side's next row. */
  const kinds: (DiffRegion['kind'] | null)[] = []
  let pairIndex = 0
  for (const row of rows) {
    if (row.kind !== 'pair') {
      kinds.push(row.kind)
      continue
    }
    const start = pairIndex * stride
    let changed = false
    for (let x = start; x < start + stride; x += 4) {
      if (stackedDiff[x] === 255 && stackedDiff[x + 1] === 0 && stackedDiff[x + 2] === 0) {
        changed = true
        break
      }
    }
    kinds.push(changed ? 'changed' : null)
    pairIndex++
  }

  const nextB = new Array<number>(rows.length + 1)
  const nextT = new Array<number>(rows.length + 1)
  nextB[rows.length] = heightA
  nextT[rows.length] = heightB
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]!
    nextB[i] = row.kind === 'added' ? nextB[i + 1]! : row.b
    nextT[i] = row.kind === 'removed' ? nextT[i + 1]! : row.t
  }

  const regions: DiffRegion[] = []
  let i = 0
  while (i < rows.length) {
    const kind = kinds[i]
    if (!kind) {
      i++
      continue
    }
    let j = i
    while (j < rows.length && kinds[j] === kind) j++
    const span = (side: 'b' | 't') => {
      const ys = rows
        .slice(i, j)
        .flatMap((row) =>
          side === 'b'
            ? row.kind === 'added'
              ? []
              : [row.b]
            : row.kind === 'removed'
              ? []
              : [row.t],
        )
      return ys.length
        ? { y: Math.min(...ys), height: Math.max(...ys) - Math.min(...ys) + 1 }
        : { y: side === 'b' ? nextB[i]! : nextT[i]!, height: 0 }
    }
    const region: DiffRegion = { kind, baseline: span('b'), target: span('t') }

    const last = regions[regions.length - 1]
    const end = (s: { y: number; height: number }) => s.y + s.height
    if (
      last &&
      last.kind === region.kind &&
      region.baseline.y - end(last.baseline) <= MERGE_GAP &&
      region.target.y - end(last.target) <= MERGE_GAP
    ) {
      if (last.baseline.height) last.baseline.height = end(region.baseline) - last.baseline.y
      if (last.target.height) last.target.height = end(region.target) - last.target.y
    } else {
      regions.push(region)
    }
    i = j
  }
  return regions
}

/**
 * Compare two screenshots.
 *
 * Images of different WIDTHS are reported as `size-mismatch` and not compared:
 * a different width is a different viewport, and the honest answer to "how
 * close is a capture at the wrong viewport" is that it was captured wrong.
 *
 * Different HEIGHTS are the normal case, not an error. A full-page capture of a
 * rebuild is almost never exactly as tall as legacy — one taller card pushes
 * every section below it down — and a top-aligned comparison would then score
 * the whole rest of the page as different. So the rows are aligned first, as a
 * text diff aligns lines (see `align`), and only aligned rows are compared
 * pixel for pixel. The same holds inside a fixed-size viewport capture, where
 * a taller header pushes content down and off the bottom.
 *
 * Alignment is ambiguous where rows repeat — whitespace, flat backgrounds — and
 * can then explain an in-place edit as rows removed here and added there. So
 * the plain top-aligned pairing is scored too, and whichever explains the two
 * pages with fewer differing pixels is the one reported: an edit in place is
 * scored in place, a moved section is scored as moved.
 *
 * A row only one side has counts its CONTENT — each pixel that stands out from
 * that page's background — not its full width: an inserted card costs the card,
 * and a page that only grew empty space costs nothing, though it is still
 * reported as different, with the space as a region.
 *
 * The score stays auditable: `comparedPixels` is width × aligned rows (paired
 * rows once, unpaired rows from whichever side has them), and `diffRatio` is
 * exactly `diffPixels / comparedPixels`.
 *
 * The threshold is pixelmatch's own default. Anti-aliasing detection is left on
 * so that a font rendered a shade differently by the same browser does not read
 * as a changed screen.
 */
export const diffScreenshots = async (
  baseline: Uint8Array,
  target: Uint8Array,
  options: DiffOptions = {},
): Promise<DiffOutcome> => {
  const { threshold = 0.1, includeAA = false, maxEdits = 1500 } = options
  const a = await decodePng(baseline)
  const b = await decodePng(target)

  if (a.width !== b.width) {
    return {
      status: 'size-mismatch',
      diffPixels: 0,
      comparedPixels: 0,
      diffRatio: 0,
      diffImage: null,
      regions: [],
    }
  }

  const width = a.width
  const stride = width * 4
  const identical = a.height === b.height && a.data.every((byte, i) => byte === b.data[i])
  const backgrounds = { a: backgroundOf(a), b: backgroundOf(b) }
  const candidates = identical
    ? [evaluate(a, b, backgrounds, topAligned(a.height, b.height), { threshold, includeAA })]
    : [
        evaluate(a, b, backgrounds, align(rowFingerprints(a), rowFingerprints(b), maxEdits), {
          threshold,
          includeAA,
        }),
        evaluate(a, b, backgrounds, topAligned(a.height, b.height), { threshold, includeAA }),
      ]
  /* Fewest differing pixels wins. On a tie, the pairing that leaves fewer rows
     unpaired: removing a strip of empty page is free, so without this an edit
     in place could be explained as new rows added and blank ones dropped. */
  const best = candidates.reduce((winner, candidate) =>
    candidate.diffPixels < winner.diffPixels ||
    (candidate.diffPixels === winner.diffPixels && candidate.unpaired < winner.unpaired)
      ? candidate
      : winner,
  )
  const { rows, stackedDiff, diffPixels, unpaired } = best
  const comparedPixels = rows.length * width

  /* The diff image runs in alignment order: pixelmatch's rendering for the
     paired rows, and a tinted, faded copy of the one side that has them for the
     rest — so a dropped section shows where it went missing. */
  const image = new Uint8Array(rows.length * stride)
  let pairIndex = 0
  rows.forEach((row, y) => {
    const out = y * stride
    if (row.kind === 'pair') {
      image.set(stackedDiff.subarray(pairIndex * stride, pairIndex * stride + stride), out)
      pairIndex++
      return
    }
    const source = row.kind === 'removed' ? a.data : b.data
    const from = (row.kind === 'removed' ? row.b : row.t) * stride
    const tint = row.kind === 'removed' ? REMOVED_TINT : ADDED_TINT
    for (let x = 0; x < stride; x += 4) {
      const grey = fade(source[from + x]!, source[from + x + 1]!, source[from + x + 2]!)
      image[out + x] = (grey + tint[0]) >> 1
      image[out + x + 1] = (grey + tint[1]) >> 1
      image[out + x + 2] = (grey + tint[2]) >> 1
      image[out + x + 3] = 255
    }
  })

  return {
    /* A page that only grew empty space is not identical: its rows no longer
       line up with legacy's, which is exactly what a region then says. */
    status: diffPixels === 0 && unpaired === 0 ? 'identical' : 'different',
    diffPixels,
    comparedPixels,
    diffRatio: comparedPixels === 0 ? 0 : diffPixels / comparedPixels,
    diffImage: await encodePng(width, rows.length, image),
    regions: regionsOf(rows, stackedDiff, stride, a.height, b.height),
  }
}
