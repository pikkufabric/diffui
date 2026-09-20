/**
 * Deleting a project takes its shots, states and branches with it.
 *
 * The cascade is declared in the migration rather than swept up in
 * `deleteProject`, because a cascade written in a function is one a second
 * delete path forgets. The proof is that the shots and branches are unreachable
 * once the project that owned them is gone — `canReachProject` cannot find an
 * owning organisation for a project that no longer exists, so the read fails
 * before the query runs.
 */
import { pikkuScenario } from '#pikku/scenarios'
import { png, putAtStorage } from '../lib/png.js'

export const deletingAProjectTakesItsShotsScenario = pikkuScenario<void, { deleted: boolean }>({
  title: 'Deleting a project takes its shots and branches with it',
  description: 'The cascade declared in the migration is triggered and its effect asserted',
  tags: ['scenario', 'shots'],
  func: async (_services, _data, { scenario, actors }) => {
    if (!actors?.maya) {
      throw new Error(
        'deletingAProjectTakesItsShotsScenario needs the maya actor — run via `pikku scenario run <environment>`',
      )
    }

    const stamp = Date.now().toString(36)

    const created = await scenario.do(
      'creates a project to delete',
      'createProject',
      { slug: `shots-cascade-${stamp}`, name: `Shots cascade ${stamp}` },
      { actor: actors.maya },
    )
    const projectId = created.project.projectId

    await scenario.do(
      'declares a route with a state and a rebuild',
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
    await scenario.do(
      'declares the rebuild',
      'declareBranch',
      { projectId, key: 'rebuild-1', label: 'Rebuild 1' },
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

    const rebuildUpload = await scenario.do(
      'asks where to put the rebuild shot',
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
    await putAtStorage(rebuildUpload, png(40, 30, { from: 10, to: 20 }))
    await scenario.do(
      'registers the rebuild shot',
      'registerShot',
      {
        projectId,
        routeKey: 'company.add-user',
        stateKey: 'default',
        viewportKey: 'desktop',
        side: 'new' as const,
        branchKey: 'rebuild-1',
        contentKey: rebuildUpload.contentKey,
        width: 40,
        height: 30,
      },
      { actor: actors.maya },
    )

    await scenario.do('deletes the project', 'deleteProject', { projectId }, { actor: actors.maya })

    await scenario.expectError(
      'its shots are unreachable',
      'listShots',
      { projectId },
      { actor: actors.maya },
    )
    await scenario.expectError(
      'and so are its branches',
      'listBranches',
      { projectId },
      { actor: actors.maya },
    )

    return { deleted: true }
  },
})
