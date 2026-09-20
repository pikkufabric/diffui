/**
 * Maya pushes a legacy screenshot and sees it against the route it is of,
 * marked as the one every rebuild is measured against.
 *
 * The push itself is `do` steps rather than clicks, because a capture run
 * arrives from the CLI holding files, not from a form — there is no upload
 * screen, by design. What the browser half proves is the other end: the shot
 * that landed in storage is actually READ back onto the screen, image included.
 *
 * `seesImage` waits for `naturalWidth > 0`, so a row that renders a broken
 * `<img>` fails here rather than passing as "the page has a screenshot on it".
 */
import { pikkuScenario } from '#pikku/scenarios'
import { png, putAtStorage } from '../lib/png.js'

export const mayaSeesHerLegacyBaselineScenario = pikkuScenario<void, { projectId: string }>({
  title: 'maya pushes a legacy shot and sees it against the route, marked as the baseline',
  description:
    'A shot that landed in storage is read back onto the project screen, image and baseline mark',
  tags: ['scenario', 'shots'],
  func: async (_services, _data, { scenario, actors }) => {
    if (!actors?.maya) {
      throw new Error(
        'mayaSeesHerLegacyBaselineScenario needs the maya actor — run via `pikku scenario run <environment>`',
      )
    }

    const stamp = Date.now().toString(36)
    const slug = `browser-baseline-${stamp}`

    const created = await scenario.do(
      'creates a project',
      'createProject',
      { slug, name: `Browser baseline ${stamp}` },
      { actor: actors.maya },
    )
    const projectId = created.project.projectId

    await scenario.do(
      'declares a route with a state on it',
      'declareRoutes',
      {
        projectId,
        routes: [
          {
            key: 'company.add-user',
            label: 'Add user',
            legacyPath: '/#/admin/users/new',
            states: [{ key: 'default', label: 'Default' }],
          },
        ],
      },
      { actor: actors.maya },
    )

    const upload = await scenario.do(
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
    await putAtStorage(upload, png(40, 30))

    await scenario.do(
      'registers it as the baseline',
      'registerShot',
      {
        projectId,
        routeKey: 'company.add-user',
        stateKey: 'default',
        viewportKey: 'desktop',
        side: 'legacy' as const,
        contentKey: upload.contentKey,
        width: 40,
        height: 30,
        makeBaseline: true,
      },
      { actor: actors.maya },
    )

    await scenario.when(
      'opens the project',
      'opensPage',
      { path: `/app/projects/${projectId}` },
      { actor: actors.maya },
    )

    await scenario.then(
      'the route the shot is of is listed',
      'seesText',
      { text: 'company.add-user' },
      { actor: actors.maya },
    )
    await scenario.then(
      'and the shot is marked as the baseline',
      'seesText',
      { text: 'Pinned baseline' },
      { actor: actors.maya },
    )
    await scenario.then(
      'and the image itself is loaded from storage',
      'seesImage',
      { testId: 'baseline-shot' },
      { actor: actors.maya },
    )

    return { projectId }
  },
})
