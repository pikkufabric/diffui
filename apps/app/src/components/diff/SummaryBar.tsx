import type { FC } from 'react'
import { Box, Group, Progress, Text, Tooltip } from '@pikku/mantine/core'
import type { I18nString } from '@pikku/react'
import { m } from '@/i18n/messages'

export type Summary = {
  scored: number
  identical: number
  different: number
  sizeMismatch: number
  notBuilt: number
  noBaseline: number
  legacyAbsent: number
  unmapped: number
}

const segments = (summary: Summary, screens: number) => {
  const notScored = screens - summary.identical - summary.different - summary.sizeMismatch
  return [
    { key: 'identical', count: summary.identical, color: 'teal', label: m.summary__identical },
    { key: 'different', count: summary.different, color: 'red', label: m.summary__different },
    {
      key: 'size-mismatch',
      count: summary.sizeMismatch,
      color: 'orange',
      label: m.summary__size_mismatch,
    },
    {
      key: 'not-scored',
      count: Math.max(notScored, 0),
      color: 'var(--mantine-color-default-border)',
      label: m.summary__not_scored,
    },
  ] as const
}

/**
 * One rebuild's screens, split by verdict, as a single bar.
 *
 * The unscored share is drawn too, in the neutral border colour, so a rebuild
 * that matched the three screens it pushed out of two hundred reads as a sliver
 * of teal on a long grey bar — not as "100%" (the-report-answers-two-questions).
 */
export const SummaryBar: FC<{
  summary: Summary
  screens: number
  size?: 'sm' | 'md' | 'lg'
  legend?: boolean
}> = ({ summary, screens, size = 'md', legend = true }) => {
  const parts = segments(summary, screens)
  const total = Math.max(screens, 1)

  return (
    <Box>
      <Progress.Root
        size={size}
        radius="xl"
        aria-label={m.summary__label()}
        data-testid="summary-bar"
      >
        {parts
          .filter((part) => part.count > 0)
          .map((part) => (
            <Tooltip key={part.key} label={part.label({ count: part.count })} withArrow>
              <Progress.Section value={(part.count / total) * 100} color={part.color} />
            </Tooltip>
          ))}
      </Progress.Root>
      {legend ? (
        <Group gap="md" mt={8} wrap="wrap">
          {parts
            .filter((part) => part.count > 0)
            .map((part) => (
              <LegendItem
                key={part.key}
                color={part.color}
                label={part.label({ count: part.count })}
              />
            ))}
        </Group>
      ) : null}
    </Box>
  )
}

const LegendItem: FC<{ color: string; label: I18nString }> = ({ color, label }) => (
  <Group gap={6} wrap="nowrap">
    <Box
      w={8}
      h={8}
      style={{
        borderRadius: 999,
        flex: 'none',
        background: color.startsWith('var(') ? color : `var(--mantine-color-${color}-filled)`,
      }}
    />
    <Text size="xs" c="dimmed">
      {label}
    </Text>
  </Group>
)
