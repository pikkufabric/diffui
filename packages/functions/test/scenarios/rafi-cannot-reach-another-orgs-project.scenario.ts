/**
 * Rafi cannot reach Maya's project.
 *
 * This is the whole reason there are two engineer personas. "You see yours, not
 * theirs" cannot be tested with one person, and a tenancy rule nobody fails is a
 * claim rather than a check — see
 * knowledge/decisions/security/an-organisation-sees-only-its-own-projects.md.
 *
 * It is driven BOTH ways on purpose:
 *
 *  - over the API, because that is where the rule lives and where anyone can
 *    reach it with curl, and
 *  - through the browser, because a screen that renders another organisation's
 *    project while the API refuses it is still a leak.
 *
 * Maya and Rafi land in separate organisations without any setup: neither has
 * one until they create their first project, and creating one makes a new
 * organisation for whoever asked.
 */
import { pikkuScenario } from '#pikku/scenarios'
import { t } from '../lib/messages.js'

export const rafiCannotReachAnotherOrgsProjectScenario = pikkuScenario<void, { projectId: string }>(
  {
    title: 'rafi cannot open maya project',
    description: 'A project is unreachable from outside the organisation that owns it',
    tags: ['scenario', 'projects', 'permissions'],
    func: async (_services, _data, { scenario, actors }) => {
      if (!actors?.maya || !actors?.rafi) {
        throw new Error(
          'rafiCannotReachAnotherOrgsProjectScenario needs the maya and rafi actors — run via `pikku scenario run <environment>`',
        )
      }

      const stamp = Date.now().toString(36)

      const created = await scenario.do(
        'creates a project of her own',
        'createProject',
        { slug: `private-${stamp}`, name: `Private ${stamp}` },
        { actor: actors.maya },
      )

      /* Rafi has his own organisation, made when he creates anything — so this is
       a genuine cross-tenant reach rather than a person with no organisation at
       all, which would pass for the wrong reason. */
      await scenario.do(
        'has an organisation of his own',
        'createProject',
        { slug: `rafis-${stamp}`, name: `Rafi's ${stamp}` },
        { actor: actors.rafi },
      )

      await scenario.expectError(
        'is refused her project over the API',
        'getProject',
        { projectId: created.project.projectId },
        { actor: actors.rafi },
      )

      await scenario.expectError(
        'and refused its routes',
        'listRoutes',
        { projectId: created.project.projectId },
        { actor: actors.rafi },
      )

      /* His own list is his own. A refusal that still leaked the row through a
       different call would pass the two assertions above. */
      const rafisProjects = await scenario.do(
        'his own projects are only his',
        'listProjects',
        {},
        { actor: actors.rafi },
      )
      if (
        rafisProjects.projects.some((project) => project.projectId === created.project.projectId)
      ) {
        throw new Error('rafi’s project list carries a project from another organisation.')
      }

      await scenario.when(
        'opens her project in his browser',
        'opensPage',
        { path: `/app/projects/${created.project.projectId}` },
        { actor: actors.rafi },
      )

      await scenario.then(
        'and the screen tells him nothing about it',
        'seesText',
        { text: t('project__not_found') },
        { actor: actors.rafi },
      )

      return { projectId: created.project.projectId }
    },
  },
)
