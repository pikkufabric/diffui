/**
 * Who may reach what.
 *
 * Both rules here answer one question — is the caller inside the organisation
 * that owns this row — and they live in the `permissions` field of every project
 * function rather than in any function body, any screen, or the CLI.
 *
 * That last one is the reason this file is worth reading. diffui has TWO
 * clients: the browser and a CLI that pushes screenshots. It is tempting to let
 * the CLI check things, because you wrote the CLI. A rule the client enforces is
 * not a rule — anyone can `POST /rpc/declareRoutes` — so the check is here,
 * where both clients meet it.
 *
 * See knowledge/decisions/security/an-organisation-sees-only-its-own-projects.md
 */
import { pikkuPermission } from '#pikku/auth'
import { callerOrganizationId, projectOrganizationId } from './lib/organization.js'

/**
 * The caller belongs to some organisation.
 *
 * For functions that do not name a project — creating one, listing your own.
 * A person in no organisation still passes: `createProject` makes them one, and
 * `listProjects` correctly returns nothing. Refusing them here would mean a new
 * signup cannot reach the screen that onboards them.
 */
export const isOrganizationMember = pikkuPermission(async (_services, _input, { session }) => {
  return Boolean(session?.userId)
})

/**
 * The caller is in the organisation that owns the named project.
 *
 * A project that does not exist and a project in someone else's organisation
 * both return false, and that is deliberate: a distinguishable "no such project"
 * tells an outsider which project ids are real.
 */
export const canReachProject = pikkuPermission<{ projectId: string }>(
  async ({ kysely }, { projectId }, { session }) => {
    if (!session?.userId || !projectId) return false

    const [caller, owner] = await Promise.all([
      callerOrganizationId(kysely, session.userId),
      projectOrganizationId(kysely, projectId),
    ])

    return Boolean(caller && owner && caller === owner)
  },
)
