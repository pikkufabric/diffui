/**
 * Maya opens the report and gets the whole answer: the scored screen worst
 * (here, the only one), the screen nobody has built listed as a gap rather than
 * as a score, and — when a number is not enough — the route opened three-up so
 * she can see legacy, the rebuild and the difference.
 *
 * `seesImage` waits for `naturalWidth > 0`, so the three-up is proven to have
 * loaded real bytes from storage rather than three empty `<img>` tags.
 */
import { pikkuScenario } from '#pikku/scenarios'
import { png, putAtStorage } from '../lib/png.js'

export const mayaReadsTheReportScenario = pikkuScenario<void, { projectId: string }>({
  title: 'maya reads the report and opens one route three-up',
  description:
    'The scored route comes first, an unbuilt route is a gap rather than a score, and the three images load',
  tags: ['scenario', 'shots'],
  func: async (_services, _data, { scenario, actors }) => {
    if (!actors?.maya) {
      throw new Error(
        'mayaReadsTheReportScenario needs the maya actor — run via `pikku scenario run <environment>`',
      )
    }

    const stamp = Date.now().toString(36)
    const created = await scenario.do(
      'creates a project',
      'createProject',
      { slug: `browser-report-${stamp}`, name: `Browser report ${stamp}` },
      { actor: actors.maya },
    )
    const projectId = created.project.projectId

    await scenario.do(
      'declares a screen legacy has and one it has not been built for',
      'declareRoutes',
      {
        projectId,
        routes: [
          { key: 'company.add-user', label: 'Add user', legacyPath: '/#/admin/users/new' },
          { key: 'company.audit', label: 'Audit log', legacyPath: '/#/admin/audit' },
        ],
      },
      { actor: actors.maya },
    )

    await scenario.do(
      'declares the rebuild',
      'declareBranch',
      { projectId, key: 'mantine', label: 'Mantine' },
      { actor: actors.maya },
    )

    const legacyUpload = await scenario.do(
      'asks where to put the legacy shot',
      'requestShotUpload',
      {
        projectId,
        routeKey: 'company.add-user',
        stateKey: 'default',
        viewportKey: 'desktop',
        side: 'legacy' as const,
        contentType: 'image/png',
      },
      { actor: actors.maya },
    )
    await putAtStorage(legacyUpload, png(40, 30))
    await scenario.do(
      'registers the legacy baseline',
      'registerShot',
      {
        projectId,
        routeKey: 'company.add-user',
        stateKey: 'default',
        viewportKey: 'desktop',
        side: 'legacy' as const,
        contentKey: legacyUpload.contentKey,
        width: 40,
        height: 30,
      },
      { actor: actors.maya },
    )

    const auditUpload = await scenario.do(
      'asks where to put the audit legacy shot',
      'requestShotUpload',
      {
        projectId,
        routeKey: 'company.audit',
        stateKey: 'default',
        viewportKey: 'desktop',
        side: 'legacy' as const,
        contentType: 'image/png',
      },
      { actor: actors.maya },
    )
    await putAtStorage(auditUpload, png(40, 30))
    await scenario.do(
      'registers the audit baseline, which the rebuild will not cover',
      'registerShot',
      {
        projectId,
        routeKey: 'company.audit',
        stateKey: 'default',
        viewportKey: 'desktop',
        side: 'legacy' as const,
        contentKey: auditUpload.contentKey,
        width: 40,
        height: 30,
      },
      { actor: actors.maya },
    )

    const rebuildUpload = await scenario.do(
      'asks where to put the rebuild shot',
      'requestShotUpload',
      {
        projectId,
        routeKey: 'company.add-user',
        stateKey: 'default',
        viewportKey: 'desktop',
        side: 'new' as const,
        branchKey: 'mantine',
        contentType: 'image/png',
      },
      { actor: actors.maya },
    )
    await putAtStorage(rebuildUpload, png(40, 30, { from: 10, to: 20 }))
    await scenario.do(
      'registers the rebuild shot, which differs',
      'registerShot',
      {
        projectId,
        routeKey: 'company.add-user',
        stateKey: 'default',
        viewportKey: 'desktop',
        side: 'new' as const,
        branchKey: 'mantine',
        contentKey: rebuildUpload.contentKey,
        width: 40,
        height: 30,
      },
      { actor: actors.maya },
    )

    await scenario.when(
      'opens the report',
      'opensPage',
      { path: `/app/projects/${projectId}/report` },
      { actor: actors.maya },
    )

    await scenario.then(
      'the scored route is listed',
      'seesText',
      { text: 'company.add-user' },
      { actor: actors.maya },
    )
    await scenario.then(
      'with its verdict',
      'seesText',
      { text: 'Different' },
      { actor: actors.maya },
    )
    await scenario.then(
      'and the screen nobody has built is listed as a gap',
      'seesText',
      { text: 'Nobody has built these' },
      { actor: actors.maya },
    )
    await scenario.then(
      'and the unbuilt route is named there',
      'seesText',
      { text: 'company.audit' },
      { actor: actors.maya },
    )

    await scenario.when(
      'opens the scored route',
      'clicks',
      { testId: 'report-open-route', containing: 'company.add-user' },
      { actor: actors.maya },
    )

    await scenario.then(
      'the legacy shot is shown',
      'seesImage',
      { testId: 'route-legacy' },
      { actor: actors.maya },
    )
    await scenario.then(
      'the rebuild shot is shown',
      'seesImage',
      { testId: 'route-target' },
      { actor: actors.maya },
    )
    await scenario.then(
      'and the difference is shown',
      'seesImage',
      { testId: 'route-diff' },
      { actor: actors.maya },
    )

    return { projectId }
  },
})
