/**
 * Shots — the screenshots themselves.
 *
 * Images NEVER pass through this API
 * (knowledge/decisions/images-never-pass-through-the-api.md). The CLI asks for
 * an upload URL, PUTs the file at the storage service directly, and then
 * registers a row that points at it. A push of four hundred screenshots is
 * four hundred uploads the API never sees a byte of.
 *
 * Everything here is addressed by KEY rather than by id. The consuming repo has
 * an inventory file with names in it and no idea what a uuid is, so the CLI
 * speaks `company.add-user` / `mobile` / `empty` and the resolution to foreign
 * keys happens here — which is also what makes an undeclared state or
 * resolution a refusal rather than a row.
 */
import { z } from 'zod'
import { pikkuFunc } from '#pikku/function'
import type { Kysely } from 'kysely'
import type { DB } from '#pikku/db/schema.gen.js'
import type { ContentService, Logger } from '@pikku/core/services'
import { canReachProject } from '../permissions.js'
import { diffScreenshots } from '../lib/diff.js'
import { Readable } from 'node:stream'

/** Where a shot sits: which screen, in which state, at which resolution. */
const CoordinatesSchema = z.object({
  projectId: z.string(),
  routeKey: z.string(),
  /* `.optional()` rather than `.default()`: a defaulted field is emitted as
     REQUIRED in the generated contract, so a default there would oblige every
     caller to pass the thing the default exists to spare them. */
  stateKey: z.string().optional(),
  viewportKey: z.string(),
})

const SideSchema = z.enum(['legacy', 'new'])

export const DeclareBranchInput = z.object({
  projectId: z.string(),
  key: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9.\-/]*$/, 'Lowercase letters, numbers, dots, hyphens and slashes'),
  label: z.string().min(1).optional(),
})

export const DeclareBranchOutput = z.object({
  branchId: z.string(),
  key: z.string(),
  label: z.string(),
})

/**
 * Declare a rebuild.
 *
 * There is no equivalent for legacy, and that is deliberate: legacy is the
 * thing being measured against, not a competitor in the same race. See
 * knowledge/decisions/legacy-is-the-only-baseline.md.
 */
export const declareBranch = pikkuFunc({
  expose: true,
  auth: true,
  permissions: { canReachProject },
  description: 'Declare a rebuild that will push screenshots, upserting it by key.',
  input: DeclareBranchInput,
  output: DeclareBranchOutput,
  func: async ({ kysely }, input) => {
    const now = new Date().toISOString()
    const label = input.label ?? input.key

    await kysely
      .insertInto('branch')
      .values({
        branchId: crypto.randomUUID(),
        projectId: input.projectId,
        key: input.key,
        label,
        createdAt: now,
        updatedAt: now,
      })
      .onConflict((oc) => oc.columns(['projectId', 'key']).doUpdateSet({ label, updatedAt: now }))
      .execute()

    const row = await kysely
      .selectFrom('branch')
      .select(['branchId', 'key', 'label'])
      .where('projectId', '=', input.projectId)
      .where('key', '=', input.key)
      .executeTakeFirstOrThrow()

    return row
  },
})

export const RequestShotUploadInput = CoordinatesSchema.extend({
  side: SideSchema,
  /** Required for a rebuild shot, refused for a legacy one — the DB enforces it too. */
  branchKey: z.string().optional(),
  contentType: z.string().optional(),
})

export const RequestShotUploadOutput = z.object({
  uploadUrl: z.string(),
  contentKey: z.string(),
  assetKey: z.string(),
  uploadMethod: z.string(),
  uploadHeaders: z.record(z.string(), z.string()).optional(),
})

/**
 * Hand back a URL the CLI can PUT an image to.
 *
 * The coordinates are resolved BEFORE the URL is issued, so a client that names
 * a screen, state or resolution the project never declared is refused here
 * rather than after it has spent a minute uploading.
 */
export const requestShotUpload = pikkuFunc({
  expose: true,
  auth: true,
  permissions: { canReachProject },
  description: 'A direct upload URL for one screenshot, at storage rather than through the API.',
  input: RequestShotUploadInput,
  output: RequestShotUploadOutput,
  func: async ({ kysely, content }, input) => {
    if (!content) {
      throw new Error(
        'No content service is available, so there is nowhere to upload a screenshot to.',
      )
    }
    const where = await resolveCoordinates(kysely, input)
    const branchId = await resolveBranch(kysely, input)

    /* The key carries the coordinates so that the stored files are legible on
       their own — someone looking at a bucket can see what an image is OF
       without joining it back to a row. The uuid on the end is what makes a
       re-push a new file rather than an overwrite of the one a comparison
       already points at. */
    const fileKey = [
      input.projectId,
      input.routeKey,
      input.stateKey,
      input.viewportKey,
      input.side === 'legacy' ? 'legacy' : `new/${input.branchKey}`,
      `${crypto.randomUUID()}.png`,
    ].join('/')

    const upload = await content.getUploadURL({
      bucket: 'shots',
      fileKey,
      contentType: input.contentType ?? 'image/png',
    })

    void where
    void branchId

    /* `contentKey` is the BUCKET-RELATIVE key, not the asset URL. The diff engine
       reads both images back by key, and an asset key that already carries a
       prefix would be resolved against the bucket a second time. */
    return {
      uploadUrl: upload.uploadUrl,
      contentKey: fileKey,
      assetKey: upload.assetKey,
      uploadMethod: upload.uploadMethod ?? 'PUT',
      uploadHeaders: upload.uploadHeaders,
    }
  },
})

export const RegisterShotInput = CoordinatesSchema.extend({
  side: SideSchema,
  branchKey: z.string().optional(),
  contentKey: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  byteSize: z.number().int().nonnegative().optional(),
  capturedAt: z.string().optional(),
  /**
   * Re-point the baseline at this legacy shot.
   *
   * Legacy still runs, so its screenshots can be refreshed — but which one
   * everybody is SCORED against has to be a decision rather than "whichever
   * landed last", or yesterday's percentages quietly stop meaning what they
   * meant. The first legacy shot for a coordinate takes the role unasked,
   * because there is nothing for it to displace.
   */
  makeBaseline: z.boolean().optional(),
})

export const RegisterShotOutput = z.object({
  shotId: z.string(),
  isBaseline: z.boolean(),
  /**
   * The verdict, when this shot was a rebuild with a baseline to score against.
   *
   * Null has two causes and the CLI must not conflate them: a legacy shot is
   * never scored at all, and a rebuild shot whose screen has no legacy baseline
   * yet is not scored EITHER — it is not zero percent, it is unanswered.
   */
  comparison: z
    .object({
      status: z.enum(['identical', 'different', 'size-mismatch']),
      diffPixels: z.number(),
      comparedPixels: z.number(),
      diffRatio: z.number(),
    })
    .nullable(),
})

export const registerShot = pikkuFunc({
  expose: true,
  auth: true,
  permissions: { canReachProject },
  description: 'Record an uploaded screenshot against the screen, state and resolution it is of.',
  input: RegisterShotInput,
  output: RegisterShotOutput,
  func: async ({ kysely, content, logger }, input) => {
    const now = new Date().toISOString()
    const where = await resolveCoordinates(kysely, input)
    const branchId = await resolveBranch(kysely, input)

    let isBaseline = false
    if (input.side === 'legacy') {
      const existing = await kysely
        .selectFrom('shot')
        .select('shotId')
        .where('routeId', '=', where.routeId)
        .where('stateId', '=', where.stateId)
        .where('viewportId', '=', where.viewportId)
        .where('isBaseline', '=', true)
        .executeTakeFirst()

      isBaseline = !existing || input.makeBaseline === true

      /* The partial unique index allows exactly one baseline per coordinate, so
         the old one is stood down before the new one is written rather than
         both being true for an instant. */
      if (existing && isBaseline) {
        await kysely
          .updateTable('shot')
          .set({ isBaseline: false })
          .where('shotId', '=', existing.shotId)
          .execute()
      }
    }

    const shotId = crypto.randomUUID()
    await kysely
      .insertInto('shot')
      .values({
        shotId,
        projectId: input.projectId,
        routeId: where.routeId,
        stateId: where.stateId,
        viewportId: where.viewportId,
        side: input.side,
        branchId,
        contentKey: input.contentKey,
        width: input.width,
        height: input.height,
        byteSize: input.byteSize ?? 0,
        isBaseline,
        capturedAt: input.capturedAt ?? now,
        createdAt: now,
      })
      .execute()

    /* The diff runs on upload rather than on read. A report that computes
       hundreds of pixel comparisons while someone waits for a page is a report
       nobody opens twice, and the answer cannot change once both images exist. */
    const comparison = await scoreAgainstBaseline(
      { kysely, content, logger },
      { projectId: input.projectId, shotId, side: input.side, ...where },
    )

    return { shotId, isBaseline, comparison }
  },
})

/**
 * Score one rebuild shot against the legacy baseline for the same coordinates.
 *
 * Always legacy-baseline against one branch shot, never branch against branch
 * (knowledge/decisions/legacy-is-the-only-baseline.md). There is no argument
 * here that could express the other thing.
 *
 * A failure to score is logged and swallowed rather than failing the upload: the
 * shot is real and already stored, and losing it because a diff could not be
 * computed would make a push fail halfway with some screens recorded and some
 * not. The comparison is simply absent, which the report reads as unanswered.
 */
const scoreAgainstBaseline = async (
  { kysely, content, logger }: { kysely: Kysely<DB>; content?: ContentService; logger: Logger },
  shot: {
    projectId: string
    shotId: string
    side: 'legacy' | 'new'
    routeId: string
    stateId: string
    viewportId: string
  },
) => {
  if (shot.side !== 'new' || !content) {
    return null
  }

  const baseline = await kysely
    .selectFrom('shot')
    .select(['shotId', 'contentKey'])
    .where('routeId', '=', shot.routeId)
    .where('stateId', '=', shot.stateId)
    .where('viewportId', '=', shot.viewportId)
    .where('side', '=', 'legacy')
    .where('isBaseline', '=', true)
    .executeTakeFirst()

  if (!baseline) {
    return null
  }

  const target = await kysely
    .selectFrom('shot')
    .select('contentKey')
    .where('shotId', '=', shot.shotId)
    .executeTakeFirstOrThrow()

  try {
    const [baselineImage, targetImage] = await Promise.all([
      content.readFileAsBuffer({ bucket: 'shots', key: baseline.contentKey }),
      content.readFileAsBuffer({ bucket: 'shots', key: target.contentKey }),
    ])

    const outcome = diffScreenshots(baselineImage, targetImage)

    let diffContentKey: string | null = null
    if (outcome.diffImage) {
      diffContentKey = `${shot.projectId}/${shot.shotId}.png`
      await content.writeFile({
        bucket: 'diffs',
        key: diffContentKey,
        stream: Readable.from(outcome.diffImage),
      })
    }

    const now = new Date().toISOString()
    await kysely
      .insertInto('comparison')
      .values({
        comparisonId: crypto.randomUUID(),
        projectId: shot.projectId,
        baselineShotId: baseline.shotId,
        targetShotId: shot.shotId,
        status: outcome.status,
        diffPixels: outcome.diffPixels,
        comparedPixels: outcome.comparedPixels,
        diffRatio: outcome.diffRatio,
        diffContentKey,
        createdAt: now,
      })
      .onConflict((oc) =>
        oc.columns(['baselineShotId', 'targetShotId']).doUpdateSet({
          status: outcome.status,
          diffPixels: outcome.diffPixels,
          comparedPixels: outcome.comparedPixels,
          diffRatio: outcome.diffRatio,
          diffContentKey,
          createdAt: now,
        }),
      )
      .execute()

    return {
      status: outcome.status,
      diffPixels: outcome.diffPixels,
      comparedPixels: outcome.comparedPixels,
      diffRatio: outcome.diffRatio,
    }
  } catch (error) {
    logger.error(
      `Could not score shot ${shot.shotId} against baseline ${baseline.shotId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return null
  }
}

/**
 * Turn the names the CLI speaks into the foreign keys the row needs.
 *
 * Each miss is its own message. "Something was not found" sends someone reading
 * a CI log hunting through three files at once, and the usual cause — a state
 * declared on one route but pushed for another — is invisible unless the error
 * says which of the three it was.
 */
export const resolveCoordinates = async (
  kysely: Kysely<DB>,
  input: { projectId: string; routeKey: string; stateKey?: string; viewportKey: string },
) => {
  const route = await kysely
    .selectFrom('route')
    .select('routeId')
    .where('projectId', '=', input.projectId)
    .where('key', '=', input.routeKey)
    .executeTakeFirst()
  if (!route) {
    throw new Error(
      `This project declares no screen called \`${input.routeKey}\`. Screens are declared by the inventory that \`init\` pushes.`,
    )
  }

  const state = await kysely
    .selectFrom('routeState')
    .select('stateId')
    .where('routeId', '=', route.routeId)
    .where('key', '=', input.stateKey ?? 'default')
    .executeTakeFirst()
  if (!state) {
    throw new Error(
      `\`${input.routeKey}\` declares no state called \`${input.stateKey ?? 'default'}\`. States belong to one screen, so a state declared on another screen does not count.`,
    )
  }

  const viewport = await kysely
    .selectFrom('viewport')
    .select('viewportId')
    .where('projectId', '=', input.projectId)
    .where('key', '=', input.viewportKey)
    .executeTakeFirst()
  if (!viewport) {
    throw new Error(
      `This project declares no resolution called \`${input.viewportKey}\`. Comparing shots captured at sizes nobody agreed on is what this refusal exists to prevent.`,
    )
  }

  return { routeId: route.routeId, stateId: state.stateId, viewportId: viewport.viewportId }
}

export const ListShotsInput = z.object({
  projectId: z.string(),
  /** Narrow to one screen, so a detail screen does not read the whole project back. */
  routeKey: z.string().optional(),
})

const ShotSchema = z.object({
  shotId: z.string(),
  routeKey: z.string(),
  stateKey: z.string(),
  viewportKey: z.string(),
  side: z.enum(['legacy', 'new']),
  branchKey: z.string().nullable(),
  width: z.number(),
  height: z.number(),
  isBaseline: z.boolean(),
  capturedAt: z.string(),
  /**
   * A short-lived, signed URL the image can be read back at.
   *
   * Signed at read time rather than stored: the local content service refuses an
   * unsigned asset URL, and a stored signature would be a URL that works until it
   * quietly does not. The key is returned alongside it so a client that wants to
   * re-derive its own URL can.
   */
  assetUrl: z.string(),
  contentKey: z.string(),
})

export const ListShotsOutput = z.object({ shots: z.array(ShotSchema) })

/**
 * A project's shots, and which of them is the pinned legacy baseline.
 *
 * Read-side companion to the push. The screenshot a rebuild is measured against
 * is a decision the CLI made at upload time (`is_baseline`), and this is where a
 * screen reads that decision back rather than guessing at "the newest one".
 */
export const listShots = pikkuFunc({
  expose: true,
  auth: true,
  readonly: true,
  permissions: { canReachProject },
  description:
    'A project’s shots with the screen, state and resolution each is of, and a URL to read it back.',
  input: ListShotsInput,
  output: ListShotsOutput,
  func: async ({ kysely, content }, input) => {
    if (!content) {
      throw new Error('No content service is available, so there is no way to read a shot back.')
    }

    let query = kysely
      .selectFrom('shot')
      .innerJoin('route', 'route.routeId', 'shot.routeId')
      .innerJoin('routeState', 'routeState.stateId', 'shot.stateId')
      .innerJoin('viewport', 'viewport.viewportId', 'shot.viewportId')
      .leftJoin('branch', 'branch.branchId', 'shot.branchId')
      .select([
        'shot.shotId as shotId',
        'shot.contentKey as contentKey',
        'shot.side as side',
        'shot.width as width',
        'shot.height as height',
        'shot.isBaseline as isBaseline',
        'shot.capturedAt as capturedAt',
        'route.key as routeKey',
        'routeState.key as stateKey',
        'viewport.key as viewportKey',
        'branch.key as branchKey',
      ])
      .where('shot.projectId', '=', input.projectId)
      .orderBy('route.sort', 'asc')
      .orderBy('routeState.sort', 'asc')
      .orderBy('viewport.sort', 'asc')

    if (input.routeKey) {
      query = query.where('route.key', '=', input.routeKey)
    }

    const rows = await query.execute()

    const expires = new Date(Date.now() + 60 * 60 * 1000)
    const shots = await Promise.all(
      rows.map(async (row) => ({
        shotId: row.shotId,
        routeKey: row.routeKey,
        stateKey: row.stateKey,
        viewportKey: row.viewportKey,
        side: row.side,
        branchKey: row.branchKey ?? null,
        width: row.width,
        height: row.height,
        isBaseline: row.isBaseline,
        capturedAt: row.capturedAt,
        contentKey: row.contentKey,
        assetUrl: await content.signContentKey({
          bucket: 'shots',
          contentKey: row.contentKey,
          dateLessThan: expires,
        }),
      })),
    )

    return { shots }
  },
})

/** A rebuild shot must name its branch; a legacy shot must not have one. */
const resolveBranch = async (
  kysely: Kysely<DB>,
  input: { projectId: string; side: 'legacy' | 'new'; branchKey?: string },
) => {
  if (input.side === 'legacy') {
    if (input.branchKey) {
      throw new Error(
        'A legacy shot cannot belong to a branch — legacy is what the branches are measured against, not one of them.',
      )
    }
    return null
  }

  if (!input.branchKey) {
    throw new Error('A rebuild shot must say which branch it came from.')
  }

  const branch = await kysely
    .selectFrom('branch')
    .select('branchId')
    .where('projectId', '=', input.projectId)
    .where('key', '=', input.branchKey)
    .executeTakeFirst()
  if (!branch) {
    throw new Error(`This project declares no branch called \`${input.branchKey}\`.`)
  }
  return branch.branchId
}
