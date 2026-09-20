/**
 * The two questions the report exists to keep apart.
 *
 * It scores the screens both sides have — worst first, with the total each
 * ratio was taken over — and it lists the screens nobody has built as gaps,
 * never as a score of zero. Folding a gap into the denominator is how a rebuild
 * that has pushed two of two hundred screens and matched them perfectly reads
 * as finished.
 *
 * A screen legacy genuinely lacks is a third thing again, and is counted on its
 * own rather than as a gap this rebuild owes.
 */
import { pikkuScenario } from '#pikku/scenarios'
import { png, putAtStorage } from '../lib/png.js'

export const reportSeparatesGapsFromScoresScenario = pikkuScenario<
  void,
  { scored: number; notBuilt: number }
>({
  title: 'the report counts unbuilt routes as gaps rather than as scores',
  description:
    'The worst route is first, an unbuilt route stays out of the denominator, and a legacy-absent route is neither a gap nor a score',
  tags: ['scenario', 'shots'],
  func: async (_services, _data, { scenario, actors }) => {
    if (!actors?.maya) {
      throw new Error(
        'reportSeparatesGapsFromScoresScenario needs the maya actor — run via `pikku scenario run <environment>`',
      )
    }

    const stamp = Date.now().toString(36)
    const created = await scenario.do(
      'creates a project',
      'createProject',
      { slug: `report-${stamp}`, name: `Report ${stamp}` },
      { actor: actors.maya },
    )
    const projectId = created.project.projectId

    await scenario.do(
      'declares four screens, three of which legacy has',
      'declareRoutes',
      {
        projectId,
        routes: [
          { key: 'company.add-user', label: 'Add user', legacyPath: '/#/admin/users/new' },
          { key: 'company.settings', label: 'Settings', legacyPath: '/#/admin/settings' },
          { key: 'company.audit', label: 'Audit log', legacyPath: '/#/admin/audit' },
          { key: 'company.help', label: 'Help', legacyAbsent: true },
        ],
      },
      { actor: actors.maya },
    )

    await scenario.do(
      'declares the rebuild',
      'declareBranch',
      { projectId, key: 'rebuild-1', label: 'Rebuild 1' },
      { actor: actors.maya },
    )

    /* A legacy baseline at the three desktop coordinates that legacy has. The
       audit one gets no branch shot, which is the gap this scenario is about. */
    const legacyDesktop = [
      { key: 'company.add-user', band: undefined as { from: number; to: number } | undefined },
      { key: 'company.settings', band: undefined as { from: number; to: number } | undefined },
      { key: 'company.audit', band: undefined as { from: number; to: number } | undefined },
    ]

    const addUserLegacyUpload = await scenario.do(
      'asks where to put the add-user legacy shot',
      'requestShotUpload',
      {
        projectId,
        routeKey: legacyDesktop[0].key,
        stateKey: 'default',
        viewportKey: 'desktop',
        side: 'legacy' as const,
        contentType: 'image/png',
      },
      { actor: actors.maya },
    )
    await putAtStorage(addUserLegacyUpload, png(40, 30))
    await scenario.do(
      'registers the add-user baseline',
      'registerShot',
      {
        projectId,
        routeKey: legacyDesktop[0].key,
        stateKey: 'default',
        viewportKey: 'desktop',
        side: 'legacy' as const,
        contentKey: addUserLegacyUpload.contentKey,
        width: 40,
        height: 30,
      },
      { actor: actors.maya },
    )

    const settingsLegacyUpload = await scenario.do(
      'asks where to put the settings legacy shot',
      'requestShotUpload',
      {
        projectId,
        routeKey: legacyDesktop[1].key,
        stateKey: 'default',
        viewportKey: 'desktop',
        side: 'legacy' as const,
        contentType: 'image/png',
      },
      { actor: actors.maya },
    )
    await putAtStorage(settingsLegacyUpload, png(40, 30))
    await scenario.do(
      'registers the settings baseline',
      'registerShot',
      {
        projectId,
        routeKey: legacyDesktop[1].key,
        stateKey: 'default',
        viewportKey: 'desktop',
        side: 'legacy' as const,
        contentKey: settingsLegacyUpload.contentKey,
        width: 40,
        height: 30,
      },
      { actor: actors.maya },
    )

    const auditLegacyUpload = await scenario.do(
      'asks where to put the audit legacy shot',
      'requestShotUpload',
      {
        projectId,
        routeKey: legacyDesktop[2].key,
        stateKey: 'default',
        viewportKey: 'desktop',
        side: 'legacy' as const,
        contentType: 'image/png',
      },
      { actor: actors.maya },
    )
    await putAtStorage(auditLegacyUpload, png(40, 30))
    await scenario.do(
      'registers the audit baseline',
      'registerShot',
      {
        projectId,
        routeKey: legacyDesktop[2].key,
        stateKey: 'default',
        viewportKey: 'desktop',
        side: 'legacy' as const,
        contentKey: auditLegacyUpload.contentKey,
        width: 40,
        height: 30,
      },
      { actor: actors.maya },
    )

    /* Two rebuild shots that differ by different amounts, so "worst first" has
       something to order: add-user is a third of the image, settings a sixth. */
    const addUserNewUpload = await scenario.do(
      'asks where to put the add-user rebuild shot',
      'requestShotUpload',
      {
        projectId,
        routeKey: 'company.add-user',
        stateKey: 'default',
        viewportKey: 'desktop',
        side: 'new' as const,
        branchKey: 'rebuild-1',
        contentType: 'image/png',
      },
      { actor: actors.maya },
    )
    await putAtStorage(addUserNewUpload, png(40, 30, { from: 0, to: 10 }))
    await scenario.do(
      'registers the add-user rebuild shot',
      'registerShot',
      {
        projectId,
        routeKey: 'company.add-user',
        stateKey: 'default',
        viewportKey: 'desktop',
        side: 'new' as const,
        branchKey: 'rebuild-1',
        contentKey: addUserNewUpload.contentKey,
        width: 40,
        height: 30,
      },
      { actor: actors.maya },
    )

    const settingsNewUpload = await scenario.do(
      'asks where to put the settings rebuild shot',
      'requestShotUpload',
      {
        projectId,
        routeKey: 'company.settings',
        stateKey: 'default',
        viewportKey: 'desktop',
        side: 'new' as const,
        branchKey: 'rebuild-1',
        contentType: 'image/png',
      },
      { actor: actors.maya },
    )
    await putAtStorage(settingsNewUpload, png(40, 30, { from: 0, to: 5 }))
    await scenario.do(
      'registers the settings rebuild shot',
      'registerShot',
      {
        projectId,
        routeKey: 'company.settings',
        stateKey: 'default',
        viewportKey: 'desktop',
        side: 'new' as const,
        branchKey: 'rebuild-1',
        contentKey: settingsNewUpload.contentKey,
        width: 40,
        height: 30,
      },
      { actor: actors.maya },
    )

    const report = await scenario.do(
      'reads the report',
      'projectReport',
      { projectId, branchKey: 'rebuild-1' },
      { actor: actors.maya },
    )

    if (report.summary.scored !== 2 || report.summary.different !== 2) {
      throw new Error(
        `The report scored ${JSON.stringify(report.summary)}; only the two pushed screens may be in the denominator.`,
      )
    }
    if (report.summary.notBuilt !== 1) {
      throw new Error(
        `An unbuilt route was reported as ${JSON.stringify(report.summary)} rather than one gap.`,
      )
    }
    if (report.summary.legacyAbsent !== 3) {
      throw new Error('A screen legacy does not have was not counted on its own.')
    }

    const first = report.rows[0]
    if (first.routeKey !== 'company.add-user') {
      throw new Error(
        `The report led with \`${first.routeKey}\` rather than the worst route — order is the work queue.`,
      )
    }
    if (!(first.diffRatio != null && first.diffRatio > (report.rows[1].diffRatio ?? 0))) {
      throw new Error('The worst route did not carry a larger measured difference than the next.')
    }
    if (first.comparedPixels !== 40 * 30) {
      throw new Error('The scored route did not carry the total its ratio was taken over.')
    }

    const unbuilt = report.rows.find((row) => row.routeKey === 'company.audit')
    if (!unbuilt || unbuilt.status !== 'not-built' || unbuilt.diffRatio !== null) {
      throw new Error(
        `A route the rebuild never pushed came back as ${JSON.stringify(unbuilt)}, which is a score.`,
      )
    }

    return { scored: report.summary.scored, notBuilt: report.summary.notBuilt }
  },
})
