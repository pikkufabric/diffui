/**
 * `declareRoutes` refuses a caller outside the organisation that owns the
 * project. The permission belongs to the function, so anyone can POST to it.
 */
import { pikkuScenario } from '#pikku/scenarios'

export const declareRoutesIsRefusedFromOutsideTheOrganizationScenario = pikkuScenario<
  void,
  { refused: boolean }
>({
  title: 'declareRoutes is refused from outside the organisation',
  description: 'A stranger cannot declare screens on a project they do not own',
  tags: ['scenario', 'permissions'],
  func: async (_services, _data, { scenario, actors }) => {
    if (!actors?.maya || !actors?.rafi) {
      throw new Error(
        'declareRoutesIsRefusedFromOutsideTheOrganizationScenario needs the maya and rafi actors — run via `pikku scenario run <environment>`',
      )
    }

    const stamp = Date.now().toString(36)

    const created = await scenario.do(
      'creates a project',
      'createProject',
      { slug: `routes-refusal-${stamp}`, name: `Routes ${stamp}` },
      { actor: actors.maya },
    )
    await scenario.do(
      'has an organisation of his own',
      'createProject',
      { slug: `routes-refusal-rafi-${stamp}`, name: `Rafi ${stamp}` },
      { actor: actors.rafi },
    )

    await scenario.expectError(
      'is refused when he declares screens on it',
      'declareRoutes',
      {
        projectId: created.project.projectId,
        routes: [{ key: 'company.add-user', label: 'Add user' }],
      },
      { actor: actors.rafi },
    )

    return { refused: true }
  },
})
