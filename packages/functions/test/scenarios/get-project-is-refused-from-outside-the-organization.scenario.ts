/**
 * `getProject` refuses a caller outside the owning organisation.
 *
 * The narrow, API-level statement of the rule that
 * `rafiCannotReachAnotherOrgsProjectScenario` proves end to end. It exists
 * separately because the permission belongs to the FUNCTION: anyone can
 * `POST /rpc/getProject`, and a rule proven only through a screen is a rule
 * proven only for people who use the screen.
 *
 * Note what it does NOT assert: a distinguishable "no such project". A refusal
 * that says "not found" for a stranger's project and "forbidden" for a real one
 * tells an outsider which project ids exist, so both fail the same way.
 */
import { pikkuScenario } from '#pikku/scenarios'

export const getProjectIsRefusedFromOutsideTheOrganizationScenario = pikkuScenario<
  void,
  { refused: boolean }
>({
  title: 'rafi cannot open maya project',
  description: 'getProject is refused to a caller outside the organisation that owns the project',
  tags: ['scenario', 'projects', 'permissions'],
  func: async (_services, _data, { scenario, actors }) => {
    if (!actors?.maya || !actors?.rafi) {
      throw new Error(
        'getProjectIsRefusedFromOutsideTheOrganizationScenario needs the maya and rafi actors — run via `pikku scenario run <environment>`',
      )
    }

    const stamp = Date.now().toString(36)

    const created = await scenario.do(
      'creates a project',
      'createProject',
      { slug: `refusal-${stamp}`, name: `Refusal ${stamp}` },
      { actor: actors.maya },
    )

    await scenario.do(
      'has an organisation of his own',
      'createProject',
      { slug: `refusal-rafi-${stamp}`, name: `Refusal Rafi ${stamp}` },
      { actor: actors.rafi },
    )

    await scenario.expectError(
      'is refused it',
      'getProject',
      { projectId: created.project.projectId },
      { actor: actors.rafi },
    )

    /* And maya still can — a permission that refuses everybody passes the
       assertion above while breaking the app. */
    await scenario.do(
      'can still open it herself',
      'getProject',
      { projectId: created.project.projectId },
      { actor: actors.maya },
    )

    return { refused: true }
  },
})
