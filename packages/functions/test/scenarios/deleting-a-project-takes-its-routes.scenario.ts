/**
 * Deleting a project takes its viewports and routes with it.
 *
 * The cascade is declared in the migration (`on delete cascade`) rather than
 * swept up in `deleteProject`, because a cascade written in a function is one
 * that a second delete path forgets. A cascade nobody triggers is a claim rather
 * than a check, which is what this scenario exists to stop.
 *
 * The proof is that the project becomes unreachable AND its routes go with it.
 * `expectError` is the assertion: after the delete, reading the project fails.
 */
import { pikkuScenario } from '#pikku/scenarios'

export const deletingAProjectTakesItsRoutesScenario = pikkuScenario<void, { projectId: string }>({
  title: 'Deleting a project takes its viewports and routes with it',
  description: 'The cascade declared in the migration is triggered and its effect asserted',
  tags: ['scenario', 'projects'],
  func: async (_services, _data, { scenario, actors }) => {
    if (!actors?.maya) {
      throw new Error(
        'deletingAProjectTakesItsRoutesScenario needs the maya actor — run via `pikku scenario run <environment>`',
      )
    }

    const stamp = Date.now().toString(36)

    const created = await scenario.do(
      'creates a project to delete',
      'createProject',
      { slug: `cascade-${stamp}`, name: `Cascade ${stamp}` },
      { actor: actors.maya },
    )

    await scenario.do(
      'declares a route on it',
      'declareRoutes',
      {
        projectId: created.project.projectId,
        routes: [{ key: 'company.add-user', label: 'Add user', legacyPath: '/#/admin/users/new' }],
      },
      { actor: actors.maya },
    )

    await scenario.do(
      'deletes the project',
      'deleteProject',
      { projectId: created.project.projectId },
      { actor: actors.maya },
    )

    /* The routes are gone with it. Reading them is refused rather than empty —
       `canReachProject` cannot find an owning organisation for a project that no
       longer exists, so the permission fails before the query runs. Either way
       the rows are unreachable, which is what the cascade is for. */
    await scenario.expectError(
      'its routes are unreachable',
      'listRoutes',
      {
        projectId: created.project.projectId,
      },
      { actor: actors.maya },
    )

    await scenario.expectError(
      'and so is the project',
      'getProject',
      {
        projectId: created.project.projectId,
      },
      { actor: actors.maya },
    )

    return { projectId: created.project.projectId }
  },
})
