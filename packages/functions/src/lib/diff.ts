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

export type DiffOutcome =
  | {
      status: 'identical' | 'different'
      diffPixels: number
      comparedPixels: number
      diffRatio: number
      diffImage: Uint8Array
    }
  | { status: 'size-mismatch'; diffPixels: 0; comparedPixels: 0; diffRatio: 0; diffImage: null }

type Decoded = { width: number; height: number; data: Uint8Array }

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
const decodePng = async (bytes: Uint8Array): Promise<Decoded> => {
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
export const diffScreenshots = async (
  baseline: Uint8Array,
  target: Uint8Array,
): Promise<DiffOutcome> => {
  const a = await decodePng(baseline)
  const b = await decodePng(target)

  if (a.width !== b.width || a.height !== b.height) {
    return {
      status: 'size-mismatch',
      diffPixels: 0,
      comparedPixels: 0,
      diffRatio: 0,
      diffImage: null,
    }
  }

  const diff = new Uint8Array(a.width * a.height * 4)
  const diffPixels = pixelmatch(a.data, b.data, diff, a.width, a.height, {
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
    diffImage: await encodePng(a.width, a.height, diff),
  }
}
