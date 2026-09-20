/**
 * `deleteProject` refuses a caller outside the organisation that owns the
 * project. The most destructive one, so a refusal proven only through a screen
 * would be the worst place to leave the rule.
 */
import { pikkuScenario } from '#pikku/scenarios'

export const deleteProjectIsRefusedFromOutsideTheOrganizationScenario = pikkuScenario<
  void,
  { refused: boolean }
>({
  title: 'deleteProject is refused from outside the organisation',
  description: 'A stranger cannot delete a project they do not own',
  tags: ['scenario', 'permissions'],
  func: async (_services, _data, { scenario, actors }) => {
    if (!actors?.maya || !actors?.rafi) {
      throw new Error(
        'deleteProjectIsRefusedFromOutsideTheOrganizationScenario needs the maya and rafi actors — run via `pikku scenario run <environment>`',
      )
    }

    const stamp = Date.now().toString(36)

    const created = await scenario.do(
      'creates a project',
      'createProject',
      { slug: `delete-refusal-${stamp}`, name: `Delete ${stamp}` },
      { actor: actors.maya },
    )
    await scenario.do(
      'has an organisation of his own',
      'createProject',
      { slug: `delete-refusal-rafi-${stamp}`, name: `Rafi ${stamp}` },
      { actor: actors.rafi },
    )

    await scenario.expectError(
      'is refused when he tries to delete it',
      'deleteProject',
      { projectId: created.project.projectId },
      { actor: actors.rafi },
    )

    /* It is still there, and still hers — a refusal that deleted the row and
       then reported an error would pass the assertion above. */
    await scenario.do(
      'and the project survives',
      'getProject',
      { projectId: created.project.projectId },
      { actor: actors.maya },
    )

    return { refused: true }
  },
})
