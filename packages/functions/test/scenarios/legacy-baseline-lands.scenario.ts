/**
 * A legacy screenshot lands against its route, state and resolution, and the
 * first one for a coordinate is pinned as the baseline everyone is measured
 * against.
 *
 * The pinning is the point. Legacy still runs and can be recaptured, so
 * "compare against the newest legacy shot" would move every rebuild's score
 * whenever the BASELINE moved, and nobody could tell that from their own work
 * regressing. So the scenario pushes a second legacy shot and asserts the
 * baseline did NOT drift, then re-pins deliberately and asserts it moved.
 *
 * The refusal at the end is the other half of the milestone's claim: a capture
 * script inventing `dialog-open-maybe` is refused at the upload-URL request,
 * before a byte moves, so the report can never fill with states nobody agreed
 * to.
 */
import { pikkuScenario } from '#pikku/scenarios'
import { png, putAtStorage } from '../lib/png.js'

export const legacyBaselineLandsScenario = pikkuScenario<
  void,
  { shotId: string; assetUrl: string }
>({
  title: 'a legacy screenshot lands against its route and is pinned as the baseline',
  description:
    'The first legacy shot for a coordinate becomes the baseline, a later one does not displace it, and an undeclared state is refused',
  tags: ['scenario', 'shots'],
  func: async (_services, _data, { scenario, actors }) => {
    if (!actors?.maya) {
      throw new Error(
        'legacyBaselineLandsScenario needs the maya actor — run via `pikku scenario run <environment>`',
      )
    }

    const stamp = Date.now().toString(36)

    const created = await scenario.do(
      'creates a project',
      'createProject',
      { slug: `baseline-${stamp}`, name: `Baseline ${stamp}` },
      { actor: actors.maya },
    )

    const projectId = created.project.projectId
    const image = png(40, 30)

    await scenario.do(
      'declares a route with a state on it',
      'declareRoutes',
      {
        projectId,
        routes: [
          {
            key: 'company.add-user',
            label: 'Add user',
            legacyPath: '/#/admin/users/new',
            states: [
              { key: 'default', label: 'Default' },
              {
                key: 'dialog-open',
                label: 'Add-user dialog open',
                ref: 'users.spec.ts > opens the dialog',
              },
            ],
          },
        ],
      },
      { actor: actors.maya },
    )

    const desktopUpload = await scenario.do(
      'asks where to put the legacy desktop shot',
      'requestShotUpload',
      {
        projectId,
        routeKey: 'company.add-user',
        stateKey: 'dialog-open',
        viewportKey: 'desktop',
        side: 'legacy' as const,
        contentType: 'image/png',
      },
      { actor: actors.maya },
    )
    await putAtStorage(desktopUpload, image)

    const desktop = await scenario.do(
      'registers the legacy desktop shot',
      'registerShot',
      {
        projectId,
        routeKey: 'company.add-user',
        stateKey: 'dialog-open',
        viewportKey: 'desktop',
        side: 'legacy' as const,
        contentKey: desktopUpload.contentKey,
        width: 40,
        height: 30,
      },
      { actor: actors.maya },
    )
    if (!desktop.isBaseline) {
      throw new Error('The first legacy shot for a coordinate did not become the baseline.')
    }

    /* A second capture of the same screen does NOT steal the baseline: the
         baseline is a decision, not whatever landed last. */
    const secondUpload = await scenario.do(
      'asks where to put a second legacy desktop shot',
      'requestShotUpload',
      {
        projectId,
        routeKey: 'company.add-user',
        stateKey: 'dialog-open',
        viewportKey: 'desktop',
        side: 'legacy' as const,
        contentType: 'image/png',
      },
      { actor: actors.maya },
    )
    await putAtStorage(secondUpload, image)

    await scenario.do(
      'registers the second one without re-pinning',
      'registerShot',
      {
        projectId,
        routeKey: 'company.add-user',
        stateKey: 'dialog-open',
        viewportKey: 'desktop',
        side: 'legacy' as const,
        contentKey: secondUpload.contentKey,
        width: 40,
        height: 30,
      },
      { actor: actors.maya },
    )

    const listed = await scenario.do(
      'reads the shots back',
      'listShots',
      { projectId },
      { actor: actors.maya },
    )

    const coordinate = listed.shots.filter(
      (shot) =>
        shot.routeKey === 'company.add-user' &&
        shot.stateKey === 'dialog-open' &&
        shot.viewportKey === 'desktop' &&
        shot.side === 'legacy',
    )
    const pinned = coordinate.filter((shot) => shot.isBaseline)
    if (pinned.length !== 1) {
      throw new Error(`A coordinate had ${pinned.length} baselines; there must be exactly one.`)
    }
    if (pinned[0].shotId !== desktop.shotId) {
      throw new Error('The baseline drifted to the newest legacy shot rather than the pinned one.')
    }
    if (!pinned[0].assetUrl.includes('/content/shots/')) {
      throw new Error(
        `The shot came back with \`${pinned[0].assetUrl}\` rather than a readable asset URL.`,
      )
    }

    /* Re-pinning is allowed, and moves the baseline — a person who recaptures
         legacy deliberately replaces what everyone is measured against. */
    const repinUpload = await scenario.do(
      'asks where to put a re-pinned replacement',
      'requestShotUpload',
      {
        projectId,
        routeKey: 'company.add-user',
        stateKey: 'dialog-open',
        viewportKey: 'desktop',
        side: 'legacy' as const,
        contentType: 'image/png',
      },
      { actor: actors.maya },
    )
    await putAtStorage(repinUpload, image)

    const repinned = await scenario.do(
      'registers it as the new baseline',
      'registerShot',
      {
        projectId,
        routeKey: 'company.add-user',
        stateKey: 'dialog-open',
        viewportKey: 'desktop',
        side: 'legacy' as const,
        contentKey: repinUpload.contentKey,
        width: 40,
        height: 30,
        makeBaseline: true,
      },
      { actor: actors.maya },
    )
    if (!repinned.isBaseline) {
      throw new Error('An explicit re-pin did not take the baseline role.')
    }

    const afterRepin = await scenario.do(
      'reads the shots back after the re-pin',
      'listShots',
      { projectId },
      { actor: actors.maya },
    )
    const pinnedAfter = afterRepin.shots.filter(
      (shot) =>
        shot.routeKey === 'company.add-user' &&
        shot.stateKey === 'dialog-open' &&
        shot.viewportKey === 'desktop' &&
        shot.side === 'legacy' &&
        shot.isBaseline,
    )
    if (pinnedAfter.length !== 1 || pinnedAfter[0].shotId !== repinned.shotId) {
      throw new Error('The explicit re-pin did not become the one baseline for the coordinate.')
    }

    await scenario.expectError(
      'is refused when she pushes a screenshot for a state she never declared',
      'requestShotUpload',
      {
        projectId,
        routeKey: 'company.add-user',
        stateKey: 'dialog-open-maybe',
        viewportKey: 'desktop',
        side: 'legacy' as const,
        contentType: 'image/png',
      },
      { actor: actors.maya },
    )

    return { shotId: repinned.shotId, assetUrl: pinnedAfter[0].assetUrl }
  },
})
