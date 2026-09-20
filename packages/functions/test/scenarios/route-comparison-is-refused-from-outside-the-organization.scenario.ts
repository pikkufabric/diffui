/**
 * `routeComparison` refuses a caller outside the organisation that owns the
 * project — the images of somebody else's product are not theirs to read.
 */
import { pikkuScenario } from '#pikku/scenarios'

export const routeComparisonIsRefusedFromOutsideTheOrganizationScenario = pikkuScenario<
  void,
  { refused: boolean }
>({
  title: 'a route comparison is refused from outside the organisation',
  description: 'A stranger cannot read the screenshots behind somebody else score',
  tags: ['scenario', 'permissions'],
  func: async (_services, _data, { scenario, actors }) => {
    if (!actors?.maya || !actors?.rafi) {
      throw new Error(
        'routeComparisonIsRefusedFromOutsideTheOrganizationScenario needs the maya and rafi actors — run via `pikku scenario run <environment>`',
      )
    }

    const stamp = Date.now().toString(36)

    const created = await scenario.do(
      'creates a project',
      'createProject',
      { slug: `comparison-refusal-${stamp}`, name: `Comparison ${stamp}` },
      { actor: actors.maya },
    )
    await scenario.do(
      'has an organisation of his own',
      'createProject',
      { slug: `comparison-refusal-rafi-${stamp}`, name: `Rafi ${stamp}` },
      { actor: actors.rafi },
    )

    await scenario.expectError(
      'is refused the comparison',
      'routeComparison',
      {
        projectId: created.project.projectId,
        branchKey: 'rebuild-1',
        routeKey: 'company.add-user',
      },
      { actor: actors.rafi },
    )

    return { refused: true }
  },
})
