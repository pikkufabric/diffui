/**
 * `diffui push` — upload screenshots and register them.
 *
 * Reads a manifest produced by whatever captured the screenshots, and for each
 * shot: asks the server where to put it, PUTs the PNG DIRECTLY at storage, and
 * then registers the row that points at it. The API never receives an image
 * byte (knowledge/decisions/images-never-pass-through-the-api.md) — a push of
 * four hundred screenshots is four hundred uploads it never sees.
 *
 * The manifest is deliberately a plain shape rather than one capture tool's
 * format, so that anything able to write a JSON file and some PNGs can feed it.
 */
import { readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { PNG } from 'pngjs'
import { rpc } from './client.js'

export type ManifestShot = {
  route: string
  state?: string
  viewport: string
  file: string
  capturedAt?: string
}

export type Manifest = {
  /** `legacy`, or the branch key of a rebuild. */
  side?: 'legacy' | 'new'
  branch?: string
  shots: ManifestShot[]
}

export type PushFilters = {
  branch?: string
  viewport?: string
  route?: string
  dryRun?: boolean
  makeBaseline?: boolean
}

/**
 * `--route` is a glob, because screens are named hierarchically (`company.*`)
 * and re-pushing one area of an app is the common case. Only `*` is supported:
 * a full glob language here would be a second thing to learn for no gain.
 */
const matchesGlob = (pattern: string, value: string) => {
  const expression = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${expression}$`).test(value)
}

export const push = async (
  server: string,
  manifestFile: string,
  options: { project: string } & PushFilters,
) => {
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as Manifest
  const root = dirname(resolve(manifestFile))

  const side = manifest.side ?? (manifest.branch ? 'new' : 'legacy')
  const branch = options.branch ?? manifest.branch

  if (side === 'new' && !branch) {
    throw new Error(
      'This manifest is a rebuild but names no branch. Pass `--branch <key>` or set `branch` in the manifest.',
    )
  }
  if (side === 'legacy' && branch) {
    throw new Error(
      'A legacy manifest cannot have a branch — legacy is what the branches are measured against, not one of them.',
    )
  }

  const selected = manifest.shots.filter(
    (shot) =>
      (!options.viewport || shot.viewport === options.viewport) &&
      (!options.route || matchesGlob(options.route, shot.route)),
  )

  if (selected.length === 0) {
    process.stdout.write('Nothing matched those filters.\n')
    return { pushed: 0, skipped: manifest.shots.length }
  }

  if (options.dryRun) {
    process.stdout.write(
      `Would push ${selected.length} of ${manifest.shots.length} shots as ${side}${branch ? ` (${branch})` : ''}:\n`,
    )
    for (const shot of selected) {
      process.stdout.write(`  ${shot.route} / ${shot.state ?? 'default'} @ ${shot.viewport}\n`)
    }
    return { pushed: 0, skipped: manifest.shots.length - selected.length, dryRun: true }
  }

  /* The branch is declared once per push rather than per shot: it is the same
     branch for every shot in a manifest, and declaring it four hundred times
     would be four hundred round trips to learn the same fact. */
  if (side === 'new' && branch) {
    await rpc(server, 'declareBranch', { projectId: options.project, key: branch })
  }

  let pushed = 0
  for (const shot of selected) {
    const file = isAbsolute(shot.file) ? shot.file : resolve(root, shot.file)
    const bytes = readFileSync(file)

    /* The dimensions are read from the PNG itself rather than taken from the
       manifest. A capture tool that reports a size it did not produce would
       make every comparison a size-mismatch for a reason nobody could see. */
    const image = PNG.sync.read(bytes)

    const coordinates = {
      projectId: options.project,
      routeKey: shot.route,
      stateKey: shot.state ?? 'default',
      viewportKey: shot.viewport,
      side,
      ...(side === 'new' ? { branchKey: branch } : {}),
    }

    const upload = await rpc<{
      uploadUrl: string
      contentKey: string
      uploadMethod: string
      uploadHeaders?: Record<string, string>
    }>(server, 'requestShotUpload', { ...coordinates, contentType: 'image/png' })

    /* Signed upload URLs are PATH-ONLY: the signature is bound to the path, so
       the client resolves it against the server it is already talking to. */
    const response = await fetch(new URL(upload.uploadUrl, server), {
      method: upload.uploadMethod,
      headers: { 'content-type': 'image/png', ...(upload.uploadHeaders ?? {}) },
      body: new Uint8Array(bytes),
    })
    if (!response.ok) {
      throw new Error(
        `Uploading ${shot.route} @ ${shot.viewport} was refused with ${response.status}: ${await response.text()}`,
      )
    }

    const registered = await rpc<{ comparison: { status: string; diffRatio: number } | null }>(
      server,
      'registerShot',
      {
        ...coordinates,
        contentKey: upload.contentKey,
        width: image.width,
        height: image.height,
        byteSize: statSync(file).size,
        ...(shot.capturedAt ? { capturedAt: shot.capturedAt } : {}),
        ...(options.makeBaseline ? { makeBaseline: true } : {}),
      },
    )

    const verdict = registered.comparison
      ? `${registered.comparison.status}${
          registered.comparison.status === 'different'
            ? ` ${(registered.comparison.diffRatio * 100).toFixed(2)}%`
            : ''
        }`
      : side === 'legacy'
        ? 'baseline'
        : 'no legacy baseline yet'

    process.stdout.write(
      `  ${shot.route} / ${shot.state ?? 'default'} @ ${shot.viewport}  →  ${verdict}\n`,
    )
    pushed += 1
  }

  process.stdout.write(`Pushed ${pushed} shots.\n`)
  return { pushed, skipped: manifest.shots.length - selected.length }
}
