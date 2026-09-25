import type { I18nString } from '@pikku/react'
import { m } from '@/i18n/messages'

export type Verdict =
  | 'identical'
  | 'different'
  | 'size-mismatch'
  | 'not-built'
  | 'no-baseline'
  | 'legacy-absent'
  | 'unmapped'

/** The three verdicts that are a MEASUREMENT; the rest are gaps in coverage. */
export const SCORED: ReadonlySet<string> = new Set(['identical', 'different', 'size-mismatch'])

/**
 * How each verdict reads, everywhere it appears.
 *
 * One table so a verdict is the same colour on the home screen, the report and
 * the route: red is "measured, and wrong", orange is "captured wrong", teal is
 * "matches", and every gap is neutral — a gap is not a failure score.
 */
export const VERDICT: Record<Verdict, { label: () => I18nString; color: string }> = {
  identical: { label: m.status__identical, color: 'teal' },
  different: { label: m.status__different, color: 'red' },
  'size-mismatch': { label: m.status__size_mismatch, color: 'orange' },
  'not-built': { label: m.status__not_built, color: 'gray' },
  'no-baseline': { label: m.status__no_baseline, color: 'gray' },
  'legacy-absent': { label: m.status__legacy_absent, color: 'gray' },
  unmapped: { label: m.status__unmapped, color: 'yellow' },
}

/** The gap kinds, each with the sentence that says what to do about it. */
export const GAP: Record<
  'not-built' | 'no-baseline' | 'unmapped' | 'legacy-absent',
  { title: () => I18nString; hint: () => I18nString }
> = {
  'not-built': { title: m.gap__not_built, hint: m.gap__not_built_hint },
  'no-baseline': { title: m.gap__no_baseline, hint: m.gap__no_baseline_hint },
  unmapped: { title: m.gap__unmapped, hint: m.gap__unmapped_hint },
  'legacy-absent': { title: m.gap__legacy_absent, hint: m.gap__legacy_absent_hint },
}

export const verdictOf = (status: string) => VERDICT[status as Verdict] ?? VERDICT.unmapped

/** A ratio as the percentage people read, to two places: 0.3333 → "33.33%". */
export const percent = (ratio: number) => `${(ratio * 100).toFixed(2)}%`
