/**
 * The overview — where every rebuild stands, on one screen.
 *
 * The home screen's question is "which rebuild needs me today", and answering it
 * from the projects list means opening each report in turn. This returns, for
 * the organisation's most recently active projects, each rebuild's summary and
 * its worst screen — the same counts the report computes (`lib/report.ts`), so
 * the two can never disagree.
 *
 * Counts, never a blended score (the-report-answers-two-questions.md): a rebuild
 * that matched the three screens it pushed is not "100%" here either.
 */
import { z } from 'zod'
import { pikkuFunc } from '#pikku/function'
import { isOrganizationMember } from '../permissions.js'
import { callerOrganizationId } from '../lib/organization.js'
import { buildReport } from '../lib/report.js'

/** Enough to fill the screen; the projects list is where the rest live. */
const RECENT_PROJECTS = 8

const Summary = z.object({
  scored: z.number(),
  identical: z.number(),
  different: z.number(),
  sizeMismatch: z.number(),
  notBuilt: z.number(),
  noBaseline: z.number(),
  legacyAbsent: z.number(),
  unmapped: z.number(),
})

export const OverviewInput = z.object({})

export const OverviewOutput = z.object({
  projectCount: z.number(),
  projects: z.array(
    z.object({
      projectId: z.string(),
      name: z.string(),
      slug: z.string(),
      baselineLabel: z.string(),
      routeCount: z.number(),
      /** The latest capture on either side, or the project's creation when nothing is captured yet. */
      lastActivity: z.string(),
      branches: z.array(
        z.object({
          key: z.string(),
          label: z.string(),
          /** Every declared route × state × viewport — the denominator coverage is read against. */
          screens: z.number(),
          summary: Summary,
          /** The screen furthest from legacy, if anything scored as different. */
          worst: z
            .object({
              routeKey: z.string(),
              routeLabel: z.string(),
              stateKey: z.string(),
              viewportKey: z.string(),
              diffRatio: z.number(),
            })
            .nullable(),
        }),
      ),
    }),
  ),
})

export const overview = pikkuFunc({
  expose: true,
  auth: true,
  readonly: true,
  permissions: { isOrganizationMember },
  description:
    'Where each of the organisation’s rebuilds stands: its report summary and worst screen, for the most recently active projects.',
  input: OverviewInput,
  output: OverviewOutput,
  func: async ({ kysely }, _input, { session }) => {
    const organizationId = await callerOrganizationId(kysely, session!.userId)
    if (!organizationId) return { projectCount: 0, projects: [] }

    const projects = await kysely
      .selectFrom('project')
      .leftJoin('shot', 'shot.projectId', 'project.projectId')
      .select((eb) => [
        'project.projectId as projectId',
        'project.name as name',
        'project.slug as slug',
        'project.baselineLabel as baselineLabel',
        'project.createdAt as createdAt',
        eb.fn.max('shot.capturedAt').as('lastCapture'),
      ])
      .where('project.organizationId', '=', organizationId)
      .groupBy('project.projectId')
      .execute()

    const recent = projects
      .map((project) => ({ ...project, lastActivity: project.lastCapture ?? project.createdAt }))
      .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity))
      .slice(0, RECENT_PROJECTS)

    const result = await Promise.all(
      recent.map(async (project) => {
        const [routes, branches] = await Promise.all([
          kysely
            .selectFrom('route')
            .select((eb) => eb.fn.countAll<number>().as('count'))
            .where('projectId', '=', project.projectId)
            .executeTakeFirstOrThrow(),
          kysely
            .selectFrom('branch')
            .select(['branchId', 'key', 'label'])
            .where('projectId', '=', project.projectId)
            .orderBy('key', 'asc')
            .execute(),
        ])

        return {
          projectId: project.projectId,
          name: project.name,
          slug: project.slug,
          baselineLabel: project.baselineLabel,
          routeCount: Number(routes.count),
          lastActivity: project.lastActivity,
          branches: await Promise.all(
            branches.map(async (branch) => {
              const report = await buildReport(kysely, project.projectId, branch.branchId)
              /* Rows arrive worst first, so the first `different` row is the worst. */
              const worst = report.rows.find((row) => row.status === 'different')
              return {
                key: branch.key,
                label: branch.label,
                screens: report.rows.length,
                summary: report.summary,
                worst: worst
                  ? {
                      routeKey: worst.routeKey,
                      routeLabel: worst.routeLabel,
                      stateKey: worst.stateKey,
                      viewportKey: worst.viewportKey,
                      diffRatio: worst.diffRatio ?? 0,
                    }
                  : null,
              }
            }),
          ),
        }
      }),
    )

    return { projectCount: projects.length, projects: result }
  },
})
