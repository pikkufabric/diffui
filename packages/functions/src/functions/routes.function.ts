/**
 * Routes — the screens a project tracks.
 *
 * A route is a NAME, not a URL (knowledge/entities/route.md), carrying the
 * legacy path and the new path. That is what lets two apps whose routing has
 * nothing in common be paired screen by screen.
 */
import { z } from 'zod'
import { pikkuFunc } from '#pikku/function'
import type { Kysely } from 'kysely'
import type { DB } from '#pikku/db/schema.gen.js'
import { canReachProject } from '../permissions.js'

/**
 * What is known about a screen on the legacy side.
 *
 * Three states, not two, and the middle one is the reason this is an enum rather
 * than a boolean: "nobody has mapped it yet" is an open question, and a report
 * that files it under "legacy does not have it" says a rebuild is finished when
 * nobody has checked.
 */
export const LegacyCoverage = z.enum(['present', 'absent', 'unmapped'])

const RouteSchema = z.object({
  routeId: z.string(),
  key: z.string(),
  label: z.string(),
  legacyPath: z.string().nullable(),
  newPath: z.string().nullable(),
  legacyCoverage: LegacyCoverage,
})

/**
 * One condition a screen can be in — empty, populated, mid-validation.
 *
 * `ref` is a note from the capturing repo to a person reading the report: the
 * fixture or test that sets this state up. diffui never parses it, never
 * resolves it and never validates it, because the moment it does, diffui is
 * coupled to whatever that repo happens to test with.
 */
const RouteStateDeclarationSchema = z.object({
  key: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9.-]*$/, 'Lowercase letters, numbers, dots and hyphens'),
  label: z.string().min(1),
  ref: z.string().nullable().optional(),
})

/** One route as the consuming repo's inventory file declares it. */
const RouteDeclarationSchema = z.object({
  key: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9.-]*$/, 'Lowercase letters, numbers, dots and hyphens'),
  label: z.string().min(1),
  legacyPath: z.string().nullable().optional(),
  newPath: z.string().nullable().optional(),
  /** Say so explicitly — it is a claim, and it is not the same as leaving the path out. */
  legacyAbsent: z.boolean().optional(),
  /**
   * The conditions this screen is captured in. A route with none declared gets a
   * single `default` state, because a shot must reference a state by foreign key
   * and most screens only ever have one — making every inventory spell that out
   * would be ceremony for the common case.
   */
  states: z.array(RouteStateDeclarationSchema).optional(),
})

export const DeclareRoutesInput = z.object({
  projectId: z.string(),
  routes: z.array(RouteDeclarationSchema).min(1),
})

export const DeclareRoutesOutput = z.object({
  declared: z.number(),
  routes: z.array(RouteSchema),
})

export const declareRoutes = pikkuFunc({
  expose: true,
  auth: true,
  permissions: { canReachProject },
  description: 'Declare the screens a project tracks, upserting each by its key.',
  input: DeclareRoutesInput,
  output: DeclareRoutesOutput,
  func: async ({ kysely }, input) => {
    const now = new Date().toISOString()

    /* Upsert on (project, key), because the key is the identity. Re-running init
       against an edited inventory has to update the routes that moved rather
       than duplicate every one of them — and an inventory is edited far more
       often than it is created. */
    for (const [index, route] of input.routes.entries()) {
      await kysely
        .insertInto('route')
        .values({
          routeId: crypto.randomUUID(),
          projectId: input.projectId,
          key: route.key,
          label: route.label,
          legacyPath: route.legacyPath ?? null,
          newPath: route.newPath ?? null,
          legacyAbsent: route.legacyAbsent ?? false,
          sort: index,
          createdAt: now,
          updatedAt: now,
        })
        .onConflict((oc) =>
          oc.columns(['projectId', 'key']).doUpdateSet({
            label: route.label,
            legacyPath: route.legacyPath ?? null,
            newPath: route.newPath ?? null,
            legacyAbsent: route.legacyAbsent ?? false,
            sort: index,
            updatedAt: now,
          }),
        )
        .execute()

      const { routeId } = await kysely
        .selectFrom('route')
        .select('routeId')
        .where('projectId', '=', input.projectId)
        .where('key', '=', route.key)
        .executeTakeFirstOrThrow()

      const states = route.states?.length
        ? route.states
        : [{ key: 'default', label: 'Default', ref: null }]

      for (const [stateIndex, state] of states.entries()) {
        await kysely
          .insertInto('routeState')
          .values({
            stateId: crypto.randomUUID(),
            routeId,
            key: state.key,
            label: state.label,
            ref: state.ref ?? null,
            sort: stateIndex,
            createdAt: now,
          })
          .onConflict((oc) =>
            oc.columns(['routeId', 'key']).doUpdateSet({
              label: state.label,
              ref: state.ref ?? null,
              sort: stateIndex,
            }),
          )
          .execute()
      }
    }

    const routes = await readRoutes(kysely, input.projectId)
    return { declared: input.routes.length, routes }
  },
})

export const ListRoutesInput = z.object({ projectId: z.string() })

export const ListRoutesOutput = z.object({
  routes: z.array(RouteSchema),
  /** The counts the coverage report is read from, so nobody derives them twice. */
  coverage: z.object({
    present: z.number(),
    absent: z.number(),
    unmapped: z.number(),
  }),
})

export const listRoutes = pikkuFunc({
  expose: true,
  auth: true,
  readonly: true,
  permissions: { canReachProject },
  description: 'A project’s routes, each with what is known about it on the legacy side.',
  input: ListRoutesInput,
  output: ListRoutesOutput,
  func: async ({ kysely }, input) => {
    const routes = await readRoutes(kysely, input.projectId)

    return {
      routes,
      coverage: {
        present: routes.filter((route) => route.legacyCoverage === 'present').length,
        absent: routes.filter((route) => route.legacyCoverage === 'absent').length,
        unmapped: routes.filter((route) => route.legacyCoverage === 'unmapped').length,
      },
    }
  },
})

/**
 * Read a project's routes and derive each one's legacy coverage.
 *
 * Derived on the way out rather than stored, because it is a reading of two
 * columns and a stored third would be a copy that drifts the first time someone
 * updates a path without it.
 */
const readRoutes = async (kysely: Kysely<DB>, projectId: string) => {
  const rows = await kysely
    .selectFrom('route')
    .select(['routeId', 'key', 'label', 'legacyPath', 'newPath', 'legacyAbsent'])
    .where('projectId', '=', projectId)
    .orderBy('sort', 'asc')
    .orderBy('key', 'asc')
    .execute()

  return rows.map((row) => ({
    routeId: row.routeId,
    key: row.key,
    label: row.label,
    legacyPath: row.legacyPath ?? null,
    newPath: row.newPath ?? null,
    legacyCoverage: row.legacyPath
      ? ('present' as const)
      : row.legacyAbsent
        ? ('absent' as const)
        : ('unmapped' as const),
  }))
}
