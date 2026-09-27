/**
 * Everything the web app shows, as commands.
 *
 * Each command is one or two RPCs the web app already calls, printed. Nothing
 * here decides anything the server does not: permissions, report counts and
 * statuses all come back from the same functions the screens read, so the CLI
 * and the browser cannot disagree about where a rebuild stands.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { rpc } from './client.js'
import { percent, printJson, printTable } from './output.js'

type Project = {
  projectId: string
  slug: string
  name: string
  baselineLabel: string
  targetLabel: string
}

type Viewport = {
  key: string
  label: string
  width: number
  height: number
  deviceScaleFactor: number
}

/**
 * `--project` takes the slug or the id.
 *
 * A slug is what a person remembers and types; an id is what a script already
 * holds from `projects create --json`. The slug is resolved against the
 * caller's own projects, so an unknown one fails here with the list of real
 * ones rather than as a permission error from the server.
 */
export const resolveProject = async (server: string, ref: string): Promise<Project> => {
  const { projects } = await rpc<{ projects: Project[] }>(server, 'listProjects', {})
  const match = projects.find((p) => p.slug === ref || p.projectId === ref)
  if (!match) {
    const known = projects.map((p) => p.slug).join(', ') || 'none yet'
    throw new Error(`No project \`${ref}\`. Your projects: ${known}.`)
  }
  return match
}

export const whoami = async (server: string, json: boolean) => {
  const me = await rpc<{ userId: string; email: string; name: string | null }>(
    server,
    'getSession',
    {},
  )
  if (json) return printJson(me)
  process.stdout.write(`${me.name ? `${me.name} <${me.email}>` : me.email}\n`)
}

// ---------------------------------------------------------------------------
// Projects

export const projectsList = async (server: string, json: boolean) => {
  const result = await rpc<{ projects: Project[] }>(server, 'listProjects', {})
  if (json) return printJson(result)
  if (result.projects.length === 0) {
    process.stdout.write('No projects yet. Create one with `diffui projects create <slug>`.\n')
    return
  }
  printTable(
    ['SLUG', 'NAME', 'ID'],
    result.projects.map((p) => [p.slug, p.name, p.projectId]),
  )
}

export const projectsCreate = async (
  server: string,
  options: { slug: string; name?: string; baselineLabel?: string; targetLabel?: string },
  json: boolean,
) => {
  const result = await rpc<{ project: Project; viewports: Viewport[] }>(server, 'createProject', {
    slug: options.slug,
    name: options.name ?? options.slug,
    ...(options.baselineLabel ? { baselineLabel: options.baselineLabel } : {}),
    ...(options.targetLabel ? { targetLabel: options.targetLabel } : {}),
  })
  if (json) return printJson(result)
  process.stdout.write(
    `Created ${result.project.slug} (${result.project.projectId}).\n` +
      `Resolutions: ${result.viewports.map((v) => v.key).join(', ')}.\n` +
      `Next: \`diffui init routes.json --project ${result.project.slug}\`.\n`,
  )
}

export const projectsShow = async (server: string, ref: string, json: boolean) => {
  const { projectId } = await resolveProject(server, ref)
  const [project, routes, branches] = await Promise.all([
    rpc<{ project: Project; viewports: Viewport[] }>(server, 'getProject', { projectId }),
    rpc<{ coverage: { present: number; absent: number; unmapped: number }; routes: unknown[] }>(
      server,
      'listRoutes',
      { projectId },
    ),
    rpc<{ branches: Array<{ key: string; label: string }> }>(server, 'listBranches', {
      projectId,
    }),
  ])
  if (json) return printJson({ ...project, coverage: routes.coverage, branches: branches.branches })

  const p = project.project
  process.stdout.write(
    `${p.name}  (${p.slug}, ${p.projectId})\n` +
      `Baseline: ${p.baselineLabel}   Target: ${p.targetLabel}\n\n` +
      `Screens: ${routes.routes.length}  ` +
      `(legacy has ${routes.coverage.present}, lacks ${routes.coverage.absent}, unmapped ${routes.coverage.unmapped})\n` +
      `Rebuilds: ${branches.branches.map((b) => b.key).join(', ') || 'none pushed yet'}\n\n`,
  )
  printTable(
    ['RESOLUTION', 'LABEL', 'SIZE', 'SCALE'],
    project.viewports.map((v) => [
      v.key,
      v.label,
      `${v.width}×${v.height}`,
      `${v.deviceScaleFactor}x`,
    ]),
  )
}

export const projectsDelete = async (
  server: string,
  ref: string,
  options: { yes: boolean },
  json: boolean,
) => {
  const project = await resolveProject(server, ref)
  /* Deleting takes every screen, shot and comparison with it. Requiring the
     flag rather than a y/N prompt keeps the command scriptable and still makes
     nobody delete a project by pressing enter. */
  if (!options.yes) {
    throw new Error(
      `This deletes ${project.slug} and every screenshot and comparison in it. Re-run with --yes to confirm.`,
    )
  }
  const result = await rpc<{ deleted: boolean }>(server, 'deleteProject', {
    projectId: project.projectId,
  })
  if (json) return printJson(result)
  process.stdout.write(result.deleted ? `Deleted ${project.slug}.\n` : 'Nothing was deleted.\n')
}

// ---------------------------------------------------------------------------
// Reading where things stand

type Summary = {
  scored: number
  identical: number
  different: number
  sizeMismatch: number
  notBuilt: number
  noBaseline: number
  legacyAbsent: number
  unmapped: number
}

/** Counts, never one blended score — see the-report-answers-two-questions.md. */
const summaryLine = (s: Summary) =>
  `${s.identical}/${s.scored} identical, ${s.different} different, ${s.sizeMismatch} size-mismatch · ` +
  `${s.notBuilt} not built, ${s.noBaseline} no baseline, ${s.unmapped} unmapped, ${s.legacyAbsent} legacy-absent`

export const overview = async (server: string, json: boolean) => {
  const result = await rpc<{
    projectCount: number
    projects: Array<{
      name: string
      slug: string
      routeCount: number
      lastActivity: string
      branches: Array<{
        key: string
        screens: number
        summary: Summary
        worst: { routeKey: string; stateKey: string; viewportKey: string; diffRatio: number } | null
      }>
    }>
  }>(server, 'overview', {})
  if (json) return printJson(result)
  if (result.projects.length === 0) {
    process.stdout.write('No projects yet. Create one with `diffui projects create <slug>`.\n')
    return
  }
  for (const project of result.projects) {
    process.stdout.write(
      `\n${project.name} (${project.slug}) — ${project.routeCount} screens, last activity ${project.lastActivity}\n`,
    )
    if (project.branches.length === 0) {
      process.stdout.write('  no rebuilds pushed yet\n')
      continue
    }
    for (const branch of project.branches) {
      process.stdout.write(`  ${branch.key}: ${summaryLine(branch.summary)}\n`)
      if (branch.worst) {
        const w = branch.worst
        process.stdout.write(
          `    worst: ${w.routeKey} / ${w.stateKey} @ ${w.viewportKey}  ${percent(w.diffRatio)}\n`,
        )
      }
    }
  }
  if (result.projectCount > result.projects.length) {
    process.stdout.write(
      `\n…and ${result.projectCount - result.projects.length} more. \`diffui projects list\` shows them all.\n`,
    )
  }
}

export const routes = async (server: string, ref: string, json: boolean) => {
  const { projectId } = await resolveProject(server, ref)
  const result = await rpc<{
    routes: Array<{
      key: string
      label: string
      legacyPath: string | null
      newPath: string | null
      legacyCoverage: 'present' | 'absent' | 'unmapped'
    }>
    coverage: { present: number; absent: number; unmapped: number }
  }>(server, 'listRoutes', { projectId })
  if (json) return printJson(result)
  if (result.routes.length === 0) {
    process.stdout.write('No screens declared yet. Run `diffui init <routes.json>`.\n')
    return
  }
  printTable(
    ['KEY', 'LEGACY', 'NEW', 'LABEL'],
    result.routes.map((r) => [
      r.key,
      r.legacyCoverage === 'absent'
        ? '(legacy lacks it)'
        : r.legacyCoverage === 'unmapped'
          ? '(unmapped)'
          : (r.legacyPath ?? ''),
      r.newPath ?? '',
      r.label,
    ]),
  )
  const c = result.coverage
  process.stdout.write(
    `\n${result.routes.length} screens: legacy has ${c.present}, lacks ${c.absent}, unmapped ${c.unmapped}.\n`,
  )
}

export const branches = async (server: string, ref: string, json: boolean) => {
  const { projectId } = await resolveProject(server, ref)
  const result = await rpc<{ branches: Array<{ branchId: string; key: string; label: string }> }>(
    server,
    'listBranches',
    { projectId },
  )
  if (json) return printJson(result)
  if (result.branches.length === 0) {
    process.stdout.write('No rebuilds yet. `diffui push --branch <key>` declares one.\n')
    return
  }
  printTable(
    ['KEY', 'LABEL'],
    result.branches.map((b) => [b.key, b.label]),
  )
}

export const shots = async (
  server: string,
  ref: string,
  options: { route?: string },
  json: boolean,
) => {
  const { projectId } = await resolveProject(server, ref)
  const result = await rpc<{
    shots: Array<{
      routeKey: string
      stateKey: string
      viewportKey: string
      side: 'legacy' | 'new'
      branchKey: string | null
      width: number
      height: number
      isBaseline: boolean
      capturedAt: string
    }>
  }>(server, 'listShots', { projectId, ...(options.route ? { routeKey: options.route } : {}) })
  if (json) return printJson(result)
  if (result.shots.length === 0) {
    process.stdout.write('No screenshots pushed yet.\n')
    return
  }
  printTable(
    ['ROUTE', 'STATE', 'RESOLUTION', 'SIDE', 'SIZE', 'CAPTURED'],
    result.shots.map((s) => [
      s.routeKey,
      s.stateKey,
      s.viewportKey,
      s.side === 'legacy'
        ? s.isBaseline
          ? 'legacy (baseline)'
          : 'legacy'
        : (s.branchKey ?? 'new'),
      `${s.width}×${s.height}`,
      s.capturedAt,
    ]),
  )
}

/** The model's verdict and its one-line summary, or why there is none. */
const reviewCell = (
  review: { status: 'done' | 'failed'; verdict: string | null; summary: string | null } | null,
) => {
  if (!review) return ''
  if (review.status === 'failed') return 'review failed'
  return `${review.verdict}: ${review.summary ?? ''}`
}

const REPORT_STATUSES = [
  'identical',
  'different',
  'size-mismatch',
  'not-built',
  'legacy-absent',
  'unmapped',
  'no-baseline',
] as const

export const report = async (
  server: string,
  ref: string,
  options: { branch: string; status?: string; failOver?: number },
  json: boolean,
) => {
  if (options.status && !REPORT_STATUSES.includes(options.status as never)) {
    throw new Error(`\`--status\` must be one of: ${REPORT_STATUSES.join(', ')}.`)
  }
  const { projectId } = await resolveProject(server, ref)
  const result = await rpc<{
    branch: { key: string; label: string }
    rows: Array<{
      routeKey: string
      stateKey: string
      viewportKey: string
      status: string
      diffRatio: number | null
      review: { status: 'done' | 'failed'; verdict: string | null; summary: string | null } | null
    }>
    summary: Summary
  }>(server, 'projectReport', { projectId, branchKey: options.branch })

  const rows = options.status ? result.rows.filter((r) => r.status === options.status) : result.rows

  if (json) {
    printJson({ ...result, rows })
  } else {
    /* Worst first: the report is read to find what to fix next. */
    const sorted = [...rows].sort((a, b) => (b.diffRatio ?? -1) - (a.diffRatio ?? -1))
    printTable(
      ['ROUTE', 'STATE', 'RESOLUTION', 'STATUS', 'DIFF', 'REVIEW'],
      sorted.map((r) => [
        r.routeKey,
        r.stateKey,
        r.viewportKey,
        r.status,
        percent(r.diffRatio),
        reviewCell(r.review),
      ]),
    )
    process.stdout.write(`\n${result.branch.key}: ${summaryLine(result.summary)}\n`)
  }

  /* A CI gate: exit non-zero when any scored screen is further off than the
     threshold. Only scored rows count — "not built" is coverage, and coverage
     is read from the summary, not failed on silently here. */
  if (options.failOver !== undefined) {
    const over = result.rows.filter((r) => (r.diffRatio ?? 0) * 100 > options.failOver!)
    if (over.length > 0) {
      process.stderr.write(`\n${over.length} screens differ by more than ${options.failOver}%.\n`)
      process.exitCode = 2
    }
  }
}

export const compare = async (
  server: string,
  ref: string,
  options: { branch: string; route: string; state?: string; viewport?: string; out?: string },
  json: boolean,
) => {
  const { projectId } = await resolveProject(server, ref)
  const result = await rpc<{
    routeKey: string
    routeLabel: string
    stateKey: string
    viewportKey: string
    branchKey: string
    status: string
    diffPixels: number | null
    comparedPixels: number | null
    diffRatio: number | null
    baseline: { assetUrl: string; width: number; height: number } | null
    target: { assetUrl: string; width: number; height: number } | null
    diff: { assetUrl: string } | null
    regions: Array<{
      kind: string
      baseline: { y: number; height: number }
      target: { y: number; height: number }
    }>
    review: {
      status: 'done' | 'failed'
      verdict: string | null
      summary: string | null
      findings: Array<{
        kind: string
        severity: string
        region: number | null
        description: string
      }>
      error: string | null
      model: string
      reviewedAt: string
    } | null
  }>(server, 'routeComparison', {
    projectId,
    branchKey: options.branch,
    routeKey: options.route,
    ...(options.state ? { stateKey: options.state } : {}),
    ...(options.viewport ? { viewportKey: options.viewport } : {}),
  })

  /* The URLs are signed and short-lived, so they are resolved against the
     server and, with --out, fetched now rather than left for later. */
  const absolute = (url: string) => new URL(url, server).toString()
  const images = {
    baseline: result.baseline && absolute(result.baseline.assetUrl),
    target: result.target && absolute(result.target.assetUrl),
    diff: result.diff && absolute(result.diff.assetUrl),
  }

  const saved: Record<string, string> = {}
  if (options.out) {
    mkdirSync(options.out, { recursive: true })
    const stem = `${result.routeKey}.${result.stateKey}.${result.viewportKey}`
    for (const [name, url] of Object.entries(images)) {
      if (!url) continue
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Downloading the ${name} image failed with ${response.status}.`)
      }
      const file = join(options.out, `${stem}.${name}.png`)
      writeFileSync(file, new Uint8Array(await response.arrayBuffer()))
      saved[name] = file
    }
  }

  if (json) return printJson({ ...result, images, saved })

  process.stdout.write(
    `${result.routeLabel} (${result.routeKey}) / ${result.stateKey} @ ${result.viewportKey} — ${result.branchKey}\n` +
      `Status: ${result.status}` +
      (result.diffRatio !== null
        ? `  ${percent(result.diffRatio)} (${result.diffPixels} of ${result.comparedPixels} pixels)`
        : '') +
      '\n',
  )
  if (result.baseline)
    process.stdout.write(`Legacy:  ${result.baseline.width}×${result.baseline.height}\n`)
  if (result.target)
    process.stdout.write(`Rebuild: ${result.target.width}×${result.target.height}\n`)
  if (result.regions.length > 0) {
    process.stdout.write('\nRegions that differ:\n')
    for (const r of result.regions) {
      process.stdout.write(
        `  ${r.kind.padEnd(8)} legacy y=${r.baseline.y}+${r.baseline.height}  rebuild y=${r.target.y}+${r.target.height}\n`,
      )
    }
  }
  if (result.review) {
    const review = result.review
    process.stdout.write(`\nReview (${review.model}, ${review.reviewedAt}):\n`)
    if (review.status === 'failed') {
      process.stdout.write(`  failed: ${review.error}\n`)
    } else {
      process.stdout.write(`  ${review.verdict}: ${review.summary}\n`)
      /* Most severe first: the review is read to decide what to fix. */
      const order = { high: 0, medium: 1, low: 2 } as Record<string, number>
      for (const f of [...review.findings].sort(
        (a, b) => order[a.severity]! - order[b.severity]!,
      )) {
        const where = f.region === null ? '' : ` [region ${f.region}]`
        process.stdout.write(
          `  - ${f.severity.padEnd(6)} ${f.kind.padEnd(12)} ${f.description}${where}\n`,
        )
      }
    }
  } else if (result.status === 'different') {
    process.stdout.write(
      `\nNot reviewed yet. \`diffui review --project ${ref} --branch ${options.branch} --route ${options.route}\` asks a model what differs.\n`,
    )
  }
  process.stdout.write('\n')
  for (const [name, url] of Object.entries(images)) {
    if (!url) continue
    process.stdout.write(`${name.padEnd(8)} ${saved[name] ?? url}\n`)
  }
}

export const review = async (
  server: string,
  ref: string,
  options: { branch: string; route?: string; limit?: number; force?: boolean },
  json: boolean,
) => {
  const { projectId } = await resolveProject(server, ref)
  const result = await rpc<{ runId: string | null; screens: number }>(server, 'requestReview', {
    projectId,
    branchKey: options.branch,
    ...(options.route ? { routeKey: options.route } : {}),
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
    ...(options.force ? { force: true } : {}),
  })
  if (json) return printJson(result)
  if (!result.runId) {
    process.stdout.write('Every flagged screen in scope already has a current review.\n')
    return
  }
  process.stdout.write(
    `Reviewing ${result.screens} flagged screen${result.screens === 1 ? '' : 's'} (run ${result.runId}).\n` +
      `Verdicts appear in \`diffui report --project ${ref} --branch ${options.branch}\` as they land.\n`,
  )
}
