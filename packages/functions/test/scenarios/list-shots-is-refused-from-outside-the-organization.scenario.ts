/**
 * `listShots` refuses a caller outside the organisation that owns the project.
 */
import { pikkuScenario } from '#pikku/scenarios'

export const listShotsIsRefusedFromOutsideTheOrganizationScenario = pikkuScenario<
  void,
  { refused: boolean }
>({
  title: 'listShots is refused from outside the organisation',
  description: 'A project screenshots are unreachable to anyone who does not own it',
  tags: ['scenario', 'permissions'],
  func: async (_services, _data, { scenario, actors }) => {
    if (!actors?.maya || !actors?.rafi) {
      throw new Error(
        'listShotsIsRefusedFromOutsideTheOrganizationScenario needs the maya and rafi actors — run via `pikku scenario run <environment>`',
      )
    }

    const stamp = Date.now().toString(36)

    const created = await scenario.do(
      'creates a project',
      'createProject',
      { slug: `list-shots-refusal-${stamp}`, name: `List shots ${stamp}` },
      { actor: actors.maya },
    )
    await scenario.do(
      'has an organisation of his own',
      'createProject',
      { slug: `list-shots-refusal-rafi-${stamp}`, name: `Rafi ${stamp}` },
      { actor: actors.rafi },
    )

    await scenario.expectError(
      'is refused its shots',
      'listShots',
      { projectId: created.project.projectId },
      { actor: actors.rafi },
    )

    return { refused: true }
  },
})
