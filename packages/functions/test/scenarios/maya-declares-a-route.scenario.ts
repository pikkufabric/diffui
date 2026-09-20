/**
 * Maya creates a project through the screen and sees the routes she declares.
 *
 * The milestone's own gherkin, driven as a person: the form is filled and
 * submitted rather than the RPC called, because the claim is that the SCREEN
 * works. An RPC that works behind a broken form is a backend, not a milestone.
 *
 * The inventory itself is pushed over the RPC — that is genuinely how it
 * arrives, from a file in the consuming repo via the CLI, and there is no form
 * for it by design.
 */
import { pikkuScenario } from '#pikku/scenarios'

export const mayaDeclaresARouteScenario = pikkuScenario<void, { projectId: string }>({
  title: 'maya creates a project, declares a route and sees it listed with its coverage state',
  description: 'The project form works, and the route list shows what is known about each screen',
  tags: ['scenario', 'projects'],
  func: async (_services, _data, { scenario, actors }) => {
    if (!actors?.maya) {
      throw new Error(
        'mayaDeclaresARouteScenario needs the maya actor — run via `pikku scenario run <environment>`',
      )
    }

    const stamp = Date.now().toString(36)
    const slug = `browser-${stamp}`

    await scenario.given(
      'opens the projects screen',
      'opensPage',
      { path: '/app/projects' },
      { actor: actors.maya },
    )

    await scenario.when(
      'names the project',
      'fills',
      { testId: 'project-name', value: `Browser ${stamp}` },
      { actor: actors.maya },
    )
    await scenario.when(
      'gives it a slug',
      'fills',
      { testId: 'project-slug', value: slug },
      { actor: actors.maya },
    )
    await scenario.when(
      'creates it',
      'clicks',
      { testId: 'project-create' },
      { actor: actors.maya },
    )

    await scenario.then(
      'and it appears in her projects',
      'seesText',
      { text: `Browser ${stamp}` },
      { actor: actors.maya },
    )

    /* The id comes from the API rather than from the page, because a project
       card does not print one — and inventing a way for it to would be putting
       a test's needs on a screen. */
    const projects = await scenario.do(
      'finds the project she just made',
      'listProjects',
      {},
      { actor: actors.maya },
    )
    const project = projects.projects.find((candidate) => candidate.slug === slug)
    if (!project) {
      throw new Error(`The project form reported success but \`${slug}\` is not in her projects.`)
    }

    await scenario.do(
      'declares the screens it tracks',
      'declareRoutes',
      {
        projectId: project.projectId,
        routes: [
          {
            key: 'company.add-user',
            label: 'Add user',
            legacyPath: '/#/admin/users/new',
            newPath: '/app/admin/users/new',
          },
          { key: 'company.billing', label: 'Billing', legacyAbsent: true },
        ],
      },
      { actor: actors.maya },
    )

    await scenario.when(
      'opens the project',
      'opensPage',
      { path: `/app/projects/${project.projectId}` },
      { actor: actors.maya },
    )

    await scenario.then(
      'the route she declared is listed',
      'seesText',
      { text: 'company.add-user' },
      { actor: actors.maya },
    )

    /* The screen distinguishes "legacy genuinely does not have it" from
       "nobody has mapped it". Asserting the words proves the distinction
       survived all the way to the page rather than only to the function. */
    await scenario.then(
      'and the screen legacy lacks is marked as absent, not merely unmapped',
      'seesText',
      { text: 'Legacy lacks it' },
      { actor: actors.maya },
    )

    return { projectId: project.projectId }
  },
})
