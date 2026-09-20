/**
 * `listBranches` refuses a caller outside the organisation that owns the
 * project — the branches are the shape of somebody else's work.
 */
import { pikkuScenario } from '#pikku/scenarios'

export const listBranchesIsRefusedFromOutsideTheOrganizationScenario = pikkuScenario<
  void,
  { refused: boolean }
>({
  title: 'listBranches is refused from outside the organisation',
  description: 'A project rebuilds are unreachable to anyone who does not own it',
  tags: ['scenario', 'permissions'],
  func: async (_services, _data, { scenario, actors }) => {
    if (!actors?.maya || !actors?.rafi) {
      throw new Error(
        'listBranchesIsRefusedFromOutsideTheOrganizationScenario needs the maya and rafi actors — run via `pikku scenario run <environment>`',
      )
    }

    const stamp = Date.now().toString(36)

    const created = await scenario.do(
      'creates a project',
      'createProject',
      { slug: `branches-refusal-${stamp}`, name: `Branches ${stamp}` },
      { actor: actors.maya },
    )
    await scenario.do(
      'has an organisation of his own',
      'createProject',
      { slug: `branches-refusal-rafi-${stamp}`, name: `Rafi ${stamp}` },
      { actor: actors.rafi },
    )

    await scenario.expectError(
      'is refused its rebuilds',
      'listBranches',
      { projectId: created.project.projectId },
      { actor: actors.rafi },
    )

    return { refused: true }
  },
})
