/**
 * `listProjects` returns only the caller's organisation's projects.
 *
 * A refusal that still leaked the row through a different call would pass a
 * refusal-only assertion, so this asserts on the returned list rather than on
 * an error: rafi asks for his projects and maya's is not among them.
 */
import { pikkuScenario } from '#pikku/scenarios'

export const listProjectsIsRefusedFromOutsideTheOrganizationScenario = pikkuScenario<
  void,
  { refused: boolean }
>({
  title: 'listProjects returns only your own organisation',
  description: 'A project from another organisation cannot appear in the caller list',
  tags: ['scenario', 'permissions'],
  func: async (_services, _data, { scenario, actors }) => {
    if (!actors?.maya || !actors?.rafi) {
      throw new Error(
        'listProjectsIsRefusedFromOutsideTheOrganizationScenario needs the maya and rafi actors — run via `pikku scenario run <environment>`',
      )
    }

    const stamp = Date.now().toString(36)

    const hers = await scenario.do(
      'creates a project of her own',
      'createProject',
      { slug: `list-refusal-${stamp}`, name: `List ${stamp}` },
      { actor: actors.maya },
    )
    await scenario.do(
      'has an organisation of his own',
      'createProject',
      { slug: `list-refusal-rafi-${stamp}`, name: `Rafi ${stamp}` },
      { actor: actors.rafi },
    )

    const hisList = await scenario.do(
      'lists his own projects',
      'listProjects',
      {},
      { actor: actors.rafi },
    )
    if (hisList.projects.some((project) => project.projectId === hers.project.projectId)) {
      throw new Error('maya project appeared in rafi project list.')
    }

    return { refused: true }
  },
})
