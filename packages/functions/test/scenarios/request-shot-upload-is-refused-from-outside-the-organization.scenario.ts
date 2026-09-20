/**
 * `requestShotUpload` refuses a caller outside the organisation that owns the
 * project — before a URL is handed out, so a stranger never gets a writable
 * path into the bucket.
 */
import { pikkuScenario } from '#pikku/scenarios'

export const requestShotUploadIsRefusedFromOutsideTheOrganizationScenario = pikkuScenario<
  void,
  { refused: boolean }
>({
  title: 'requestShotUpload is refused from outside the organisation',
  description: 'A stranger is handed no upload URL for a project they do not own',
  tags: ['scenario', 'permissions'],
  func: async (_services, _data, { scenario, actors }) => {
    if (!actors?.maya || !actors?.rafi) {
      throw new Error(
        'requestShotUploadIsRefusedFromOutsideTheOrganizationScenario needs the maya and rafi actors — run via `pikku scenario run <environment>`',
      )
    }

    const stamp = Date.now().toString(36)

    const created = await scenario.do(
      'creates a project',
      'createProject',
      { slug: `upload-refusal-${stamp}`, name: `Upload ${stamp}` },
      { actor: actors.maya },
    )
    await scenario.do(
      'has an organisation of his own',
      'createProject',
      { slug: `upload-refusal-rafi-${stamp}`, name: `Rafi ${stamp}` },
      { actor: actors.rafi },
    )

    await scenario.expectError(
      'is refused an upload URL',
      'requestShotUpload',
      {
        projectId: created.project.projectId,
        routeKey: 'company.add-user',
        stateKey: 'default',
        viewportKey: 'desktop',
        side: 'legacy' as const,
        contentType: 'image/png',
      },
      { actor: actors.rafi },
    )

    return { refused: true }
  },
})
