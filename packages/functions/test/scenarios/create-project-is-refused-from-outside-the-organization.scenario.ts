/**
 * `createProject` is scoped to the caller's own organisation.
 *
 * It cannot strictly be "refused" — a signed-in person with no organisation is
 * allowed, because creating their first project is how they get one. What the
 * rule promises is that the project lands in the CALLER's organisation and
 * never in somebody else's, so rafi's project must not appear in maya's list.
 */
import { pikkuScenario } from '#pikku/scenarios'

export const createProjectIsRefusedFromOutsideTheOrganizationScenario = pikkuScenario<
  void,
  { refused: boolean }
>({
  title: 'a project is created inside the caller organisation',
  description: 'createProject is scoped to the caller, so it cannot reach another organisation',
  tags: ['scenario', 'permissions'],
  func: async (_services, _data, { scenario, actors }) => {
    if (!actors?.maya || !actors?.rafi) {
      throw new Error(
        'createProjectIsRefusedFromOutsideTheOrganizationScenario needs the maya and rafi actors — run via `pikku scenario run <environment>`',
      )
    }

    const stamp = Date.now().toString(36)

    const hers = await scenario.do(
      'creates a project of her own',
      'createProject',
      { slug: `create-refusal-${stamp}`, name: `Create ${stamp}` },
      { actor: actors.maya },
    )
    const his = await scenario.do(
      'creates a project of his own',
      'createProject',
      { slug: `create-refusal-rafi-${stamp}`, name: `Rafi ${stamp}` },
      { actor: actors.rafi },
    )

    const herList = await scenario.do(
      'lists her own projects',
      'listProjects',
      {},
      { actor: actors.maya },
    )
    if (herList.projects.some((project) => project.projectId === his.project.projectId)) {
      throw new Error('rafi project was created inside maya organisation.')
    }
    if (!herList.projects.some((project) => project.projectId === hers.project.projectId)) {
      throw new Error('maya could not see the project she just created.')
    }

    return { refused: true }
  },
})
