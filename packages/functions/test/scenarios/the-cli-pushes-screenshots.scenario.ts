/**
 * The command engineers actually run, end to end.
 *
 * Every other scenario reaches the app over RPC as a persona. This one drives
 * the `diffui` binary the way a consuming repo does: declare the inventory,
 * push the legacy baseline, push a rebuild — then read back that the server
 * pinned the baseline and scored the rebuild. It is the only proof that the
 * CLI's argument parsing, manifest reading and push path work together.
 *
 * It runs without a persona on purpose: the CLI authenticates as a machine
 * credential (`DIFFUI_API_KEY`), which is the whole point of that path.
 */
import { pikkuScenario } from '#pikku/scenarios'

export const theCliPushesScreenshotsScenario = pikkuScenario<void, { projectId: string }>({
  title: 'the diffui CLI declares an inventory and pushes a scored rebuild',
  description:
    'The CLI authenticates with a machine credential, pushes a legacy baseline and a rebuild, and the server pins and scores them',
  tags: ['scenario', 'cli', 'shots'],
  func: async (_services, _data, { scenario }) => {
    const pushed = await scenario.when(
      'pushes the captures with the diffui CLI',
      'pushesScreenshotsWithTheCli',
      {},
      {},
    )

    await scenario.then(
      'the legacy shot is pinned as the baseline and the rebuild is scored',
      'seesTheCliLandedTheBaseline',
      { projectId: pushed.projectId },
      {},
    )

    return { projectId: pushed.projectId }
  },
})
