/**
 * `registerShot` refuses a caller outside the organisation that owns the
 * project, so a stranger cannot attach a screenshot to somebody else's screen.
 */
import { pikkuScenario } from '#pikku/scenarios'

export const registerShotIsRefusedFromOutsideTheOrganizationScenario = pikkuScenario<
  void,
  { refused: boolean }
>({
  title: 'registerShot is refused from outside the organisation',
  description: 'A stranger cannot record a screenshot against a project they do not own',
  tags: ['scenario', 'permissions'],
  func: async (_services, _data, { scenario, actors }) => {
    if (!actors?.maya || !actors?.rafi) {
      throw new Error(
        'registerShotIsRefusedFromOutsideTheOrganizationScenario needs the maya and rafi actors — run via `pikku scenario run <environment>`',
      )
    }

    const stamp = Date.now().toString(36)

    const created = await scenario.do(
      'creates a project',
      'createProject',
      { slug: `register-refusal-${stamp}`, name: `Register ${stamp}` },
      { actor: actors.maya },
    )
    await scenario.do(
      'has an organisation of his own',
      'createProject',
      { slug: `register-refusal-rafi-${stamp}`, name: `Rafi ${stamp}` },
      { actor: actors.rafi },
    )

    await scenario.expectError(
      'is refused when he records a shot',
      'registerShot',
      {
        projectId: created.project.projectId,
        routeKey: 'company.add-user',
        stateKey: 'default',
        viewportKey: 'desktop',
        side: 'legacy' as const,
        contentKey: 'shots/nobody/company.add-user/default/desktop/legacy/x.png',
        width: 10,
        height: 10,
      },
      { actor: actors.rafi },
    )

    return { refused: true }
  },
})
