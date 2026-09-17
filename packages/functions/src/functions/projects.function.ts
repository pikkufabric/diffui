/**
 * Projects — create, read, delete.
 *
 * A project is one legacy app and the rebuilds chasing it
 * (knowledge/entities/project.md). It belongs to an organisation, and every
 * function here is gated on that in its `permissions` field.
 */
import { z } from 'zod'
import { pikkuFunc } from '#pikku/function'
import { isOrganizationMember, canReachProject } from '../permissions.js'
import { ensureCallerOrganizationId, callerOrganizationId } from '../lib/organization.js'

/**
 * The resolutions every new project starts with.
 *
 * Seeded rather than left to the engineer because a project with no declared
 * viewport cannot accept a single shot — the first thing anyone does would
 * otherwise be to invent three.
 *
 * They are rows, not constants, precisely so a project can change them. A team
 * whose app is desktop-only deletes two; a team supporting a watch adds one.
 */
const DEFAULT_VIEWPORTS = [
  { key: 'desktop', label: 'Desktop', width: 1440, height: 900, deviceScaleFactor: 1, sort: 0 },
  { key: 'tablet', label: 'Tablet', width: 834, height: 1112, deviceScaleFactor: 2, sort: 1 },
  { key: 'mobile', label: 'Mobile', width: 390, height: 844, deviceScaleFactor: 3, sort: 2 },
] as const

const ViewportSchema = z.object({
  viewportId: z.string(),
  key: z.string(),
  label: z.string(),
  width: z.number(),
  height: z.number(),
  deviceScaleFactor: z.number(),
})

const ProjectSchema = z.object({
  projectId: z.string(),
  slug: z.string(),
  name: z.string(),
  baselineLabel: z.string(),
  targetLabel: z.string(),
})

export const CreateProjectInput = z.object({
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'Lowercase letters, numbers and hyphens'),
  name: z.string().min(1),
  baselineLabel: z.string().min(1).optional(),
  targetLabel: z.string().min(1).optional(),
})

export const CreateProjectOutput = z.object({
  project: ProjectSchema,
  viewports: z.array(ViewportSchema),
})

export const createProject = pikkuFunc({
  expose: true,
  auth: true,
  permissions: { isOrganizationMember },
  description: 'Create a project, and seed the three resolutions it captures at.',
  input: CreateProjectInput,
  output: CreateProjectOutput,
  func: async ({ kysely }, input, { session }) => {
    const organizationId = await ensureCallerOrganizationId(kysely, session!.userId)

    const projectId = crypto.randomUUID()
    const now = new Date().toISOString()

    await kysely
      .insertInto('project')
      .values({
        projectId,
        organizationId,
        slug: input.slug,
        name: input.name,
        baselineLabel: input.baselineLabel ?? 'legacy',
        targetLabel: input.targetLabel ?? 'new',
        createdAt: now,
        updatedAt: now,
      })
      .execute()

    const viewports = DEFAULT_VIEWPORTS.map((viewport) => ({
      viewportId: crypto.randomUUID(),
      projectId,
      key: viewport.key,
      label: viewport.label,
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.deviceScaleFactor,
      sort: viewport.sort,
      createdAt: now,
    }))

    await kysely.insertInto('viewport').values(viewports).execute()

    return {
      project: {
        projectId,
        slug: input.slug,
        name: input.name,
        baselineLabel: input.baselineLabel ?? 'legacy',
        targetLabel: input.targetLabel ?? 'new',
      },
      viewports: viewports.map(({ viewportId, key, label, width, height, deviceScaleFactor }) => ({
        viewportId,
        key,
        label,
        width,
        height,
        deviceScaleFactor,
      })),
    }
  },
})

export const ListProjectsInput = z.object({})

export const ListProjectsOutput = z.object({
  projects: z.array(ProjectSchema),
})

export const listProjects = pikkuFunc({
  expose: true,
  auth: true,
  readonly: true,
  permissions: { isOrganizationMember },
  description: 'The projects belonging to the caller’s organisation, and no others.',
  input: ListProjectsInput,
  output: ListProjectsOutput,
  func: async ({ kysely }, _input, { session }) => {
    const organizationId = await callerOrganizationId(kysely, session!.userId)
    /* Nobody's organisation is not an error — a person who has just signed up
       has no projects, which is exactly what an empty list says. */
    if (!organizationId) return { projects: [] }

    const projects = await kysely
      .selectFrom('project')
      .select(['projectId', 'slug', 'name', 'baselineLabel', 'targetLabel'])
      .where('organizationId', '=', organizationId)
      .orderBy('name', 'asc')
      .execute()

    return { projects }
  },
})

export const GetProjectInput = z.object({ projectId: z.string() })

export const GetProjectOutput = z.object({
  project: ProjectSchema,
  viewports: z.array(ViewportSchema),
})

export const getProject = pikkuFunc({
  expose: true,
  auth: true,
  readonly: true,
  permissions: { canReachProject },
  description: 'One project with the resolutions it captures at.',
  input: GetProjectInput,
  output: GetProjectOutput,
  func: async ({ kysely }, input) => {
    const project = await kysely
      .selectFrom('project')
      .select(['projectId', 'slug', 'name', 'baselineLabel', 'targetLabel'])
      .where('projectId', '=', input.projectId)
      .executeTakeFirstOrThrow()

    const viewports = await kysely
      .selectFrom('viewport')
      .select(['viewportId', 'key', 'label', 'width', 'height', 'deviceScaleFactor'])
      .where('projectId', '=', input.projectId)
      .orderBy('sort', 'asc')
      .execute()

    return { project, viewports }
  },
})

export const DeleteProjectInput = z.object({ projectId: z.string() })

export const DeleteProjectOutput = z.object({ deleted: z.boolean() })

export const deleteProject = pikkuFunc({
  expose: true,
  auth: true,
  permissions: { canReachProject },
  description: 'Delete a project and everything hanging off it.',
  input: DeleteProjectInput,
  output: DeleteProjectOutput,
  func: async ({ kysely }, input) => {
    /* The viewports and routes go with it by `on delete cascade`, declared in
       the migration rather than swept up here — a cascade written in a function
       is one that a second delete path forgets. */
    const result = await kysely
      .deleteFrom('project')
      .where('projectId', '=', input.projectId)
      .executeTakeFirst()

    return { deleted: (result.numDeletedRows ?? 0n) > 0n }
  },
})
