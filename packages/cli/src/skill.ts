/**
 * `diffui skill install` — put the diffui skill where a coding agent finds it.
 *
 * The agent doing a rebuild works in the CONSUMING repo, not in this one, so the
 * skill ships with the CLI and is copied there. It is copied rather than linked:
 * a link into wherever the CLI happens to be installed breaks on the next
 * machine, and the copy can be committed with the repo it describes.
 *
 * Re-running it replaces the skill's own files with this CLI's version, so an
 * upgrade is the same command. Nothing else in the target directory is touched.
 */
import { cpSync, existsSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE = fileURLToPath(new URL('../skill/diffui', import.meta.url))

export const installSkill = (options: { dir?: string }) => {
  if (!existsSync(join(SOURCE, 'SKILL.md'))) {
    throw new Error(`This CLI was installed without its skill (${SOURCE} is missing).`)
  }
  const target = resolve(options.dir ?? join('.claude', 'skills', 'diffui'))
  const upgrading = existsSync(join(target, 'SKILL.md'))

  cpSync(SOURCE, target, { recursive: true, force: true })

  const shown = relative(process.cwd(), target) || '.'
  const files = readdirSync(target, { recursive: true, withFileTypes: true }).filter((f) =>
    f.isFile(),
  ).length
  process.stdout.write(
    `${upgrading ? 'Updated' : 'Installed'} the diffui skill in ${shown} (${files} files).\n` +
      `Scripts: node ${join(shown, 'scripts')}/shoot.mjs --help\n` +
      `Start from ${join(shown, 'example', 'shoot.json')}.\n`,
  )
}
