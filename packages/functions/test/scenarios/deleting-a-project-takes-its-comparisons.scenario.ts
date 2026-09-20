/**
 * Deleting a project takes its comparisons with it.
 *
 * The comparisons hang off the shots, which hang off the project, so the delete
 * has to reach two levels down. Proving it by reading the report and the
 * comparison back after the project is gone is what makes the cascade a check
 * rather than a claim.
 */
import { pikkuScenario } from '#pikku/scenarios'
import { png, putAtStorage } from '../lib/png.js'

export const deletingAProjectTakesItsComparisonsScenario = pikkuScenario<
  void,
  { deleted: boolean }
>({
  title: 'Deleting a project takes its comparisons with it',
  description: 'A scored project leaves no comparison reachable once it is deleted',
  tags: ['scenario', 'shots'],
  func: async (_services, _data, { scenario, actors }) => {
    if (!actors?.maya) {
      throw new Error(
        'deletingAProjectTakesItsComparisonsScenario needs the maya actor — run via `pikku scenario run <environment>`',
      )
    }

    const stamp = Date.now().toString(36)

    const created = await scenario.do(
      'creates a project to delete',
      'createProject',
      { slug: `comparisons-cascade-${stamp}`, name: `Comparisons cascade ${stamp}` },
      { actor: actors.maya },
    )
    const projectId = created.project.projectId

    await scenario.do(
      'declares a route with a state',
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
    const scored = await scenario.do(
      'registers the rebuild shot, which creates a comparison',
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
    if (scored.comparison == null) {
      throw new Error('The rebuild shot was not scored, so there is no comparison to cascade.')
    }

    await scenario.do('deletes the project', 'deleteProject', { projectId }, { actor: actors.maya })

    await scenario.expectError(
      'the report is unreachable',
      'projectReport',
      { projectId, branchKey: 'rebuild-1' },
      { actor: actors.maya },
    )
    await scenario.expectError(
      'and so is the comparison behind it',
      'routeComparison',
      { projectId, branchKey: 'rebuild-1', routeKey: 'company.add-user' },
      { actor: actors.maya },
    )

    return { deleted: true }
  },
})
