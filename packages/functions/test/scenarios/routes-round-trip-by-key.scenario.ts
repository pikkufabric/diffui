/**
 * The route inventory round-trips, and its three coverage states survive.
 *
 * The assertion at the end is about the MIDDLE state. `unmapped` and `absent`
 * both have no `legacy_path`, so anything reading only the path collapses them
 * into one — and a report that does that says a rebuild is finished when nobody
 * has checked whether legacy even had the screen.
 *
 * It also proves the upsert. An inventory file is edited far more often than it
 * is created, so `declareRoutes` run twice has to update rather than duplicate.
 *
 * The assertions are `expectEventually` rather than a declared step because a
 * step runs in the CLI process, where there is no database service — asserting
 * over the RPC is both simpler and a truer test, since it is the same call the
 * screen makes.
 */
import { z } from 'zod'
import { pikkuScenario } from '#pikku/scenarios'
import { ListRoutesOutput } from '../../src/functions/routes.function.js'

export const routesRoundTripByKeyScenario = pikkuScenario<void, { keys: string[] }>({
  title: 'Routes are declared by key and read back with their coverage state',
  description:
    'Declaring twice updates rather than duplicates, and all three coverage states survive the round trip',
  tags: ['scenario', 'projects'],
  func: async (_services, _data, { scenario, actors }) => {
    if (!actors?.maya) {
      throw new Error(
        'routesRoundTripByKeyScenario needs the maya actor — run via `pikku scenario run <environment>`',
      )
    }

    /* Unique per run: there is no state reset, so a fixed slug collides with
       every previous run of this scenario. */
    const stamp = Date.now().toString(36)

    const created = await scenario.do(
      'creates a project',
      'createProject',
      { slug: `round-trip-${stamp}`, name: `Round trip ${stamp}` },
      { actor: actors.maya },
    )

    const inventory = [
      {
        key: 'company.add-user',
        label: 'Add user',
        legacyPath: '/#/admin/users/new',
        newPath: '/app/admin/users/new',
      },
      { key: 'company.billing', label: 'Billing', legacyAbsent: true },
      { key: 'company.audit', label: 'Audit log' },
    ]

    await scenario.do(
      'declares three screens, one in each coverage state',
      'declareRoutes',
      { projectId: created.project.projectId, routes: inventory },
      { actor: actors.maya },
    )

    /* Declared AGAIN with one label edited, to prove the key is the identity
       and not just a column. */
    await scenario.do(
      'declares the same inventory again with one label edited',
      'declareRoutes',
      {
        projectId: created.project.projectId,
        routes: inventory.map((route) =>
          route.key === 'company.add-user' ? { ...route, label: 'Invite user' } : route,
        ),
      },
      { actor: actors.maya },
    )

    const listed = await scenario.expectEventually(
      'the project holds three routes, one in each coverage state',
      'listRoutes',
      { projectId: created.project.projectId },
      /* `expectEventually` does not infer its predicate's argument, so it is named here. */
      (out: z.infer<typeof ListRoutesOutput>) =>
        out.routes.length === 3 &&
        out.coverage.present === 1 &&
        out.coverage.absent === 1 &&
        out.coverage.unmapped === 1 &&
        out.routes.find((route) => route.key === 'company.add-user')?.label === 'Invite user',
      { actor: actors.maya },
    )

    return { keys: listed.routes.map((route) => route.key) }
  },
})
