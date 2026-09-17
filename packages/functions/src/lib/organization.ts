/**
 * Who the caller is acting for.
 *
 * A diffui project belongs to an ORGANISATION, never to a user
 * (knowledge/decisions/one-app-orgs-for-tenancy.md), so every read and write
 * starts by answering "which organisation is this person in".
 *
 * Better Auth's organisation plugin records that on `member`, and also tracks an
 * `active_organization_id` on the session row for people who belong to several.
 * Pikku's `UserSession` carries only `userId`, so the membership table is what is
 * read here rather than the session.
 *
 * KNOWN LIMIT, stated rather than hidden: someone in more than one organisation
 * resolves to their earliest membership, because nothing in the session says
 * which one they mean. That is correct for every person this app has today — an
 * engineer works in one organisation — and the day it is not, the fix is an
 * explicit organisation on the input rather than a better guess here.
 */
import type { Kysely } from 'kysely'
import type { DB } from '#pikku/db/schema.gen.js'

/** The organisation this person is acting for, or null if they are in none. */
export const callerOrganizationId = async (
  kysely: Kysely<DB>,
  userId: string,
): Promise<string | null> => {
  const membership = await kysely
    .selectFrom('member')
    .select('organizationId')
    .where('userId', '=', userId)
    .orderBy('createdAt', 'asc')
    .executeTakeFirst()

  return membership?.organizationId ?? null
}

/**
 * The organisation this person is acting for, creating one if they have none.
 *
 * First project creates the organisation that owns it. The alternative is an
 * onboarding step that exists only to satisfy a foreign key, and a signed-in
 * person who cannot do the one thing the app is for until they have done
 * something else first.
 *
 * Rows are written directly rather than through the plugin's `createOrganization`
 * API because that call wants a request context this function does not have.
 * The shape is the plugin's own — the columns come from its generated migration
 * — so an organisation created here is indistinguishable from one it created.
 */
export const ensureCallerOrganizationId = async (
  kysely: Kysely<DB>,
  userId: string,
): Promise<string> => {
  const existing = await callerOrganizationId(kysely, userId)
  if (existing) return existing

  const user = await kysely
    .selectFrom('user')
    .select(['name', 'email'])
    .where('id', '=', userId)
    .executeTakeFirstOrThrow()

  const organizationId = crypto.randomUUID()
  const now = new Date().toISOString()

  /* The slug is unique across the whole table, so it carries the id rather than
     the person's name: two people called Maya signing up is not an error. */
  await kysely
    .insertInto('organization')
    .values({
      id: organizationId,
      name: `${user.name ?? user.email}'s organisation`,
      slug: `org-${organizationId.slice(0, 8)}`,
      createdAt: now,
    })
    .execute()

  await kysely
    .insertInto('member')
    .values({
      id: crypto.randomUUID(),
      organizationId,
      userId,
      role: 'owner',
      createdAt: now,
    })
    .execute()

  return organizationId
}

/** The organisation that owns a project, or null if there is no such project. */
export const projectOrganizationId = async (
  kysely: Kysely<DB>,
  projectId: string,
): Promise<string | null> => {
  const project = await kysely
    .selectFrom('project')
    .select('organizationId')
    .where('projectId', '=', projectId)
    .executeTakeFirst()

  return project?.organizationId ?? null
}
