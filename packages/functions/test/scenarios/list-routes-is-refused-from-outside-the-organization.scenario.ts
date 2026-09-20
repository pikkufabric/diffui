/**
 * `listRoutes` refuses a caller outside the organisation that owns the project.
 */
import { pikkuScenario } from '#pikku/scenarios'

export const listRoutesIsRefusedFromOutsideTheOrganizationScenario = pikkuScenario<
  void,
  { refused: boolean }
>({
  title: 'listRoutes is refused from outside the organisation',
  description: 'A project routes are unreachable to anyone who does not own it',
  tags: ['scenario', 'permissions'],
  func: async (_services, _data, { scenario, actors }) => {
    if (!actors?.maya || !actors?.rafi) {
      throw new Error(
        'listRoutesIsRefusedFromOutsideTheOrganizationScenario needs the maya and rafi actors — run via `pikku scenario run <environment>`',
      )
    }

    const stamp = Date.now().toString(36)

    const created = await scenario.do(
      'creates a project',
      'createProject',
      { slug: `list-routes-refusal-${stamp}`, name: `List routes ${stamp}` },
      { actor: actors.maya },
    )
    await scenario.do(
      'has an organisation of his own',
      'createProject',
      { slug: `list-routes-refusal-rafi-${stamp}`, name: `Rafi ${stamp}` },
      { actor: actors.rafi },
    )

    await scenario.expectError(
      'is refused its routes',
      'listRoutes',
      { projectId: created.project.projectId },
      { actor: actors.rafi },
    )

    return { refused: true }
  },
})
