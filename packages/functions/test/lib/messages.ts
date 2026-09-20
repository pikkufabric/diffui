/**
 * The app's own copy, for a scenario to assert on.
 *
 * A step that hardcodes "Pinned baseline" passes only while the app renders the
 * base locale, and a copy edit turns it into a selector timeout pointing at the
 * wrong file. Reading from the catalogue by KEY keeps the assertion tied to the
 * control's meaning: rename the message and the value follows it; delete the key
 * and `MessageKey` stops compiling.
 *
 * Typed off `messages/en.json` — the tracked source, not the generated Paraglide
 * output — so a misspelled key is a compile error.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type catalogue from '../../../../apps/app/messages/en.json'

export type MessageKey = keyof typeof catalogue

let cached: Record<string, string> | undefined

const messages = (): Record<string, string> => {
  cached ??= JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../../apps/app/messages/en.json', import.meta.url)),
      'utf8',
    ),
  ) as Record<string, string>
  return cached
}

/** The base-locale string for one catalogue key. */
export const t = (key: MessageKey): string => {
  const value = messages()[key]
  if (!value) throw new Error(`No message catalogue entry for \`${key}\``)
  return value
}
