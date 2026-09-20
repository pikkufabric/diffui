/**
 * Real PNG bytes for the scenarios that push shots.
 *
 * The capture side of this app is exercised with actual images rather than
 * stubs, because "the bytes never pass through the API" is a claim about files
 * at storage, and a fake buffer would not touch that path. `png` writes a solid
 * image, optionally with a band of a second colour across the middle so a diff
 * has something measurable to find.
 */
import { PNG } from 'pngjs'

export const png = (width: number, height: number, band?: { from: number; to: number }) => {
  const image = new PNG({ width, height })
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (width * y + x) << 2
      const inBand = band && y >= band.from && y < band.to
      image.data[i] = inBand ? 0 : 220
      image.data[i + 1] = inBand ? 0 : 60
      image.data[i + 2] = inBand ? 0 : 60
      image.data[i + 3] = 255
    }
  }
  return PNG.sync.write(image)
}

/** PUT the bytes straight at storage. No step: the API is not involved. */
export const putAtStorage = async (
  upload: { uploadUrl: string; uploadMethod: string; uploadHeaders?: Record<string, string> },
  image: Buffer,
) => {
  /* The signed upload URL is path-only: the signature is bound to the PATH, so
     the client resolves it against the server it is already talking to. A real
     `diffui push` does the same with its configured server URL. */
  const base = process.env.PIKKU_API_URL ?? `http://localhost:${process.env.API_PORT ?? 3300}`
  const response = await fetch(new URL(upload.uploadUrl, base), {
    method: upload.uploadMethod,
    headers: { 'content-type': 'image/png', ...(upload.uploadHeaders ?? {}) },
    body: new Uint8Array(image),
  })
  if (!response.ok) {
    throw new Error(
      `The presigned upload was refused with ${response.status}: ${await response.text()}`,
    )
  }
}
