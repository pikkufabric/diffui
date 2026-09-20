/**
 * `projectReport` refuses a caller outside the organisation that owns the
 * project — the scores are the whole picture of what someone is building.
 */
import { pikkuScenario } from '#pikku/scenarios'

export const projectReportIsRefusedFromOutsideTheOrganizationScenario = pikkuScenario<
  void,
  { refused: boolean }
>({
  title: 'the project report is refused from outside the organisation',
  description: 'A stranger cannot read how far somebody else rebuild is',
  tags: ['scenario', 'permissions'],
  func: async (_services, _data, { scenario, actors }) => {
    if (!actors?.maya || !actors?.rafi) {
      throw new Error(
        'projectReportIsRefusedFromOutsideTheOrganizationScenario needs the maya and rafi actors — run via `pikku scenario run <environment>`',
      )
    }

    const stamp = Date.now().toString(36)

    const created = await scenario.do(
      'creates a project',
      'createProject',
      { slug: `report-refusal-${stamp}`, name: `Report ${stamp}` },
      { actor: actors.maya },
    )
    await scenario.do(
      'has an organisation of his own',
      'createProject',
      { slug: `report-refusal-rafi-${stamp}`, name: `Rafi ${stamp}` },
      { actor: actors.rafi },
    )

    await scenario.expectError(
      'is refused the report',
      'projectReport',
      { projectId: created.project.projectId, branchKey: 'rebuild-1' },
      { actor: actors.rafi },
    )

    return { refused: true }
  },
})
