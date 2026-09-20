/**
 * The whole slice, with real bytes.
 *
 * A project is created, its screens and resolutions declared, a rebuild
 * declared, and then actual PNGs are uploaded DIRECTLY to storage through
 * presigned URLs — the API never sees an image byte, which is the decision this
 * scenario exists to keep honest
 * (knowledge/decisions/images-never-pass-through-the-api.md).
 *
 * Three outcomes are driven on purpose, because each one is a different claim:
 *
 *   desktop  identical      the rebuild matches legacy exactly
 *   mobile   different      it does not, and the percentage is computed
 *   tablet   size-mismatch  the two images are different sizes and are NOT
 *                           resized, padded, or scored
 *
 * And a screen legacy genuinely lacks is reported as `legacy-absent` rather
 * than as a rebuild failing to cover it.
 */
import { PNG } from 'pngjs'
import { pikkuScenario } from '#pikku/scenarios'

/** A solid image, optionally with a band of a second colour across the middle. */
const png = (width: number, height: number, band?: { from: number; to: number }) => {
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
const putAtStorage = async (
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

export const aRebuildIsScoredScenario = pikkuScenario<
  void,
  { identical: number; different: number }
>({
  title: 'a rebuild is scored against the legacy baseline',
  description:
    'Screenshots are uploaded directly to storage, diffed against the legacy baseline, and reported',
  tags: ['scenario', 'shots'],
  func: async (_services, _data, { scenario, actors }) => {
    if (!actors?.maya) {
      throw new Error('aRebuildIsScoredScenario needs the maya actor')
    }

    const stamp = Date.now().toString(36)

    const created = await scenario.do(
      'creates a project',
      'createProject',
      { slug: `scored-${stamp}`, name: `Scored ${stamp}` },
      { actor: actors.maya },
    )

    await scenario.do(
      'declares the screens it tracks',
      'declareRoutes',
      {
        projectId: created.project.projectId,
        routes: [
          { key: 'company.add-user', label: 'Add user', legacyPath: '/#/admin/users/new' },
          { key: 'company.billing', label: 'Billing', legacyAbsent: true },
        ],
      },
      { actor: actors.maya },
    )

    await scenario.do(
      'declares the rebuild that will push shots',
      'declareBranch',
      { projectId: created.project.projectId, key: 'rebuild-1', label: 'Rebuild 1' },
      { actor: actors.maya },
    )

    /* Each screenshot goes all the way through: ask where to put it, PUT the
         bytes at storage, then register the row that points at them. The steps
         are written out rather than looped because a scenario's steps are read
         statically — a loop would record nothing and run as an empty scenario. */
    const legacy = png(40, 30)

    const desktopLegacyUpload = await scenario.do(
      'asks where to put the legacy desktop shot',
      'requestShotUpload',
      {
        projectId: created.project.projectId,
        routeKey: 'company.add-user',
        stateKey: 'default',
        viewportKey: 'desktop',
        side: 'legacy' as const,
        contentType: 'image/png',
      },
      { actor: actors.maya },
    )
    await putAtStorage(desktopLegacyUpload, legacy)
    const desktopLegacy = await scenario.do(
      'registers the legacy desktop shot',
      'registerShot',
      {
        projectId: created.project.projectId,
        routeKey: 'company.add-user',
        stateKey: 'default',
        viewportKey: 'desktop',
        side: 'legacy' as const,
        contentKey: desktopLegacyUpload.contentKey,
        width: 40,
        height: 30,
      },
      { actor: actors.maya },
    )

    const sameUpload = await scenario.do(
      'asks where to put the new desktop shot',
      'requestShotUpload',
      {
        projectId: created.project.projectId,
        routeKey: 'company.add-user',
        stateKey: 'default',
        viewportKey: 'desktop',
        side: 'new' as const,
        branchKey: 'rebuild-1',
        contentType: 'image/png',
      },
      { actor: actors.maya },
    )
    await putAtStorage(sameUpload, png(40, 30))
    const same = await scenario.do(
      'registers the new desktop shot',
      'registerShot',
      {
        projectId: created.project.projectId,
        routeKey: 'company.add-user',
        stateKey: 'default',
        viewportKey: 'desktop',
        side: 'new' as const,
        branchKey: 'rebuild-1',
        contentKey: sameUpload.contentKey,
        width: 40,
        height: 30,
      },
      { actor: actors.maya },
    )

    if (same.comparison?.status !== 'identical') {
      throw new Error(
        `An identical rebuild screenshot scored \`${same.comparison?.status}\` rather than identical.`,
      )
    }

    const mobileLegacyUpload = await scenario.do(
      'asks where to put the legacy mobile shot',
      'requestShotUpload',
      {
        projectId: created.project.projectId,
        routeKey: 'company.add-user',
        stateKey: 'default',
        viewportKey: 'mobile',
        side: 'legacy' as const,
        contentType: 'image/png',
      },
      { actor: actors.maya },
    )
    await putAtStorage(mobileLegacyUpload, legacy)
    const mobileLegacy = await scenario.do(
      'registers the legacy mobile shot',
      'registerShot',
      {
        projectId: created.project.projectId,
        routeKey: 'company.add-user',
        stateKey: 'default',
        viewportKey: 'mobile',
        side: 'legacy' as const,
        contentKey: mobileLegacyUpload.contentKey,
        width: 40,
        height: 30,
      },
      { actor: actors.maya },
    )

    const changedUpload = await scenario.do(
      'asks where to put the new mobile shot',
      'requestShotUpload',
      {
        projectId: created.project.projectId,
        routeKey: 'company.add-user',
        stateKey: 'default',
        viewportKey: 'mobile',
        side: 'new' as const,
        branchKey: 'rebuild-1',
        contentType: 'image/png',
      },
      { actor: actors.maya },
    )
    await putAtStorage(changedUpload, png(40, 30, { from: 10, to: 20 }))
    const changed = await scenario.do(
      'registers the new mobile shot',
      'registerShot',
      {
        projectId: created.project.projectId,
        routeKey: 'company.add-user',
        stateKey: 'default',
        viewportKey: 'mobile',
        side: 'new' as const,
        branchKey: 'rebuild-1',
        contentKey: changedUpload.contentKey,
        width: 40,
        height: 30,
      },
      { actor: actors.maya },
    )

    if (changed.comparison?.status !== 'different') {
      throw new Error(
        `A changed rebuild screenshot scored \`${changed.comparison?.status}\` rather than different.`,
      )
    }
    /* The band is a third of the image, so the ratio must be a real measured
         fraction rather than 0 or 1 — which is what a diff that silently
         compared an image with itself, or gave up, would produce. */
    if (!(changed.comparison.diffRatio > 0.2 && changed.comparison.diffRatio < 0.5)) {
      throw new Error(
        `A band over a third of the image scored ${changed.comparison.diffRatio}, which is not a measurement of it.`,
      )
    }
    if (changed.comparison.comparedPixels !== 40 * 30) {
      throw new Error(
        `comparedPixels was ${changed.comparison.comparedPixels}, so the percentage cannot be audited.`,
      )
    }

    const tabletLegacyUpload = await scenario.do(
      'asks where to put the legacy tablet shot',
      'requestShotUpload',
      {
        projectId: created.project.projectId,
        routeKey: 'company.add-user',
        stateKey: 'default',
        viewportKey: 'tablet',
        side: 'legacy' as const,
        contentType: 'image/png',
      },
      { actor: actors.maya },
    )
    await putAtStorage(tabletLegacyUpload, legacy)
    const tabletLegacy = await scenario.do(
      'registers the legacy tablet shot',
      'registerShot',
      {
        projectId: created.project.projectId,
        routeKey: 'company.add-user',
        stateKey: 'default',
        viewportKey: 'tablet',
        side: 'legacy' as const,
        contentKey: tabletLegacyUpload.contentKey,
        width: 40,
        height: 30,
      },
      { actor: actors.maya },
    )

    const mismatchedUpload = await scenario.do(
      'asks where to put the new tablet shot',
      'requestShotUpload',
      {
        projectId: created.project.projectId,
        routeKey: 'company.add-user',
        stateKey: 'default',
        viewportKey: 'tablet',
        side: 'new' as const,
        branchKey: 'rebuild-1',
        contentType: 'image/png',
      },
      { actor: actors.maya },
    )
    await putAtStorage(mismatchedUpload, png(20, 15))
    const mismatched = await scenario.do(
      'registers the new tablet shot',
      'registerShot',
      {
        projectId: created.project.projectId,
        routeKey: 'company.add-user',
        stateKey: 'default',
        viewportKey: 'tablet',
        side: 'new' as const,
        branchKey: 'rebuild-1',
        contentKey: mismatchedUpload.contentKey,
        width: 20,
        height: 15,
      },
      { actor: actors.maya },
    )

    /* Different dimensions are reported, never reconciled. */
    if (mismatched.comparison?.status !== 'size-mismatch') {
      throw new Error(
        `Screenshots of different sizes scored \`${mismatched.comparison?.status}\` rather than size-mismatch — something resized or padded them.`,
      )
    }
    if (mismatched.comparison.comparedPixels !== 0) {
      throw new Error('A size-mismatch reported compared pixels, so something did compare them.')
    }

    const report = await scenario.do(
      'reads the report',
      'projectReport',
      { projectId: created.project.projectId, branchKey: 'rebuild-1' },
      { actor: actors.maya },
    )

    const { summary } = report
    if (summary.identical !== 1 || summary.different !== 1 || summary.sizeMismatch !== 1) {
      throw new Error(`The report scored ${JSON.stringify(summary)}, which is not what was pushed.`)
    }
    /* Billing at three resolutions. Legacy genuinely lacks it, so it is not a
         gap in the rebuild and must never be counted as one. */
    if (summary.legacyAbsent !== 3) {
      throw new Error(
        `A screen legacy does not have was reported as ${JSON.stringify(summary)} rather than as three legacy-absent rows.`,
      )
    }
    if (summary.scored !== 2) {
      throw new Error(
        `\`scored\` was ${summary.scored}; a size-mismatch or an absent screen has been folded into the denominator.`,
      )
    }

    return { identical: summary.identical, different: summary.different }
  },
})
