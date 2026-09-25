import type { FC, ReactNode } from 'react'
import { Anchor, Box, Breadcrumbs, Group, Stack, Text, Title } from '@pikku/mantine/core'
import type { I18nNode, I18nString } from '@pikku/react'
import { m } from '@/i18n/messages'

export type Crumb = { label: I18nString; render: (children: I18nString) => ReactNode }

/**
 * The top of every signed-in screen: where you are, what this is, and what you
 * can do from here.
 *
 * Breadcrumbs because the screens nest — project, report, one screen three-up —
 * and a "back" button only knows one level. The actions wrap under the title on
 * a phone instead of squeezing it, which is how a long project name used to
 * clip its own button.
 */
export const PageHeader: FC<{
  title: I18nNode
  description?: I18nNode
  crumbs?: Crumb[]
  actions?: ReactNode
  aside?: ReactNode
}> = ({ title, description, crumbs, actions, aside }) => (
  <Box mb="lg">
    {crumbs && crumbs.length > 0 ? (
      <Breadcrumbs
        aria-label={m.breadcrumb__label()}
        separatorMargin={6}
        mb={10}
        styles={{ separator: { color: 'var(--mantine-color-dimmed)' } }}
      >
        {crumbs.map((crumb, i) => (
          <Box key={i} fz="sm">
            {crumb.render(crumb.label)}
          </Box>
        ))}
      </Breadcrumbs>
    ) : null}
    <Group justify="space-between" align="flex-start" gap="sm">
      <Stack gap={6} style={{ flex: '1 1 320px', minWidth: 0 }}>
        <Group gap="sm" align="center" wrap="wrap">
          <Title
            order={1}
            fz={{ base: 22, sm: 26 }}
            fw={650}
            style={{ letterSpacing: '-0.025em', lineHeight: 1.15, overflowWrap: 'anywhere' }}
          >
            {title}
          </Title>
          {aside}
        </Group>
        {description ? (
          <Text c="dimmed" size="sm" maw={720} style={{ lineHeight: 1.55 }}>
            {description}
          </Text>
        ) : null}
      </Stack>
      {actions ? (
        <Group gap="xs" style={{ flex: 'none' }}>
          {actions}
        </Group>
      ) : null}
    </Group>
  </Box>
)

/** A breadcrumb link, dimmed so the current page's title stays the loudest thing. */
export const CrumbAnchor: FC<{
  children: I18nString
  renderRoot: (props: Record<string, unknown>) => ReactNode
}> = ({ children, renderRoot }) => (
  <Anchor c="dimmed" underline="hover" fz="sm" renderRoot={renderRoot}>
    {children}
  </Anchor>
)
