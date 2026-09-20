/**
 * `declareBranch` refuses a caller outside the organisation that owns the
 * project, so a stranger cannot invent a rebuild others would read scores for.
 */
import { pikkuScenario } from '#pikku/scenarios'

export const declareBranchIsRefusedFromOutsideTheOrganizationScenario = pikkuScenario<
  void,
  { refused: boolean }
>({
  title: 'declareBranch is refused from outside the organisation',
  description: 'A stranger cannot declare a rebuild on a project they do not own',
  tags: ['scenario', 'permissions'],
  func: async (_services, _data, { scenario, actors }) => {
    if (!actors?.maya || !actors?.rafi) {
      throw new Error(
        'declareBranchIsRefusedFromOutsideTheOrganizationScenario needs the maya and rafi actors — run via `pikku scenario run <environment>`',
      )
    }

    const stamp = Date.now().toString(36)

    const created = await scenario.do(
      'creates a project',
      'createProject',
      { slug: `branch-refusal-${stamp}`, name: `Branch ${stamp}` },
      { actor: actors.maya },
    )
    await scenario.do(
      'has an organisation of his own',
      'createProject',
      { slug: `branch-refusal-rafi-${stamp}`, name: `Rafi ${stamp}` },
      { actor: actors.rafi },
    )

    await scenario.expectError(
      'is refused when he declares a rebuild',
      'declareBranch',
      { projectId: created.project.projectId, key: 'stranger-rebuild' },
      { actor: actors.rafi },
    )

    return { refused: true }
  },
})
