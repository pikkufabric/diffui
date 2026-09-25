import type { FC } from 'react'
import {
  Anchor,
  Box,
  Button,
  Card,
  Group,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  ThemeIcon,
} from '@pikku/mantine/core'
import type { I18nString } from '@pikku/react'
import { Link } from '@tanstack/react-router'
import { usePikkuQuery } from '@project/functions-sdk/pikku/api.gen'
import { m, asI18n } from '@/i18n/messages'
import { useLocale } from '@/i18n/config'
import { PageHeader } from '@/components/PageHeader'
import { SummaryBar } from '@/components/diff/SummaryBar'
import { percent } from '@/components/diff/status'
import { ProjectsGlyph } from '@/components/layout/nav'

type Overview = NonNullable<ReturnType<typeof usePikkuQuery<'overview'>>['data']>
type Project = Overview['projects'][number]

const Stat: FC<{ label: I18nString; value: number; tone?: string; testId: string }> = ({
  label,
  value,
  tone,
  testId,
}) => (
  <Card withBorder radius="lg" padding="md" data-testid={testId}>
    <Text size="xs" c="dimmed" fw={500}>
      {label}
    </Text>
    <Text fz={28} fw={650} mt={2} c={tone} style={{ letterSpacing: '-0.02em', lineHeight: 1.1 }}>
      {value}
    </Text>
  </Card>
)

const lastActivity = (iso: string) =>
  asI18n(new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(iso)))

/** One project: each rebuild's breakdown, and the screen furthest from legacy. */
const ProjectCard: FC<{ project: Project }> = ({ project }) => (
  <Card withBorder radius="lg" padding="lg" data-testid="overview-project" data-slug={project.slug}>
    <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
      <Stack gap={2} style={{ minWidth: 0 }}>
        <Anchor
          fw={650}
          fz="md"
          c="var(--mantine-color-text)"
          underline="hover"
          style={{ overflowWrap: 'anywhere' }}
          renderRoot={(props) => (
            <Link
              to="/app/projects/$projectId"
              params={{ projectId: project.projectId }}
              {...props}
            />
          )}
        >
          {asI18n(project.name)}
        </Anchor>
        <Text size="xs" c="dimmed">
          {m.home__routes_count({ count: project.routeCount })}
          {asI18n(' · ')}
          {m.home__last_activity({ date: lastActivity(project.lastActivity) })}
        </Text>
      </Stack>
    </Group>

    {project.branches.length === 0 ? (
      <Text size="sm" c="dimmed" mt="md">
        {m.home__no_rebuilds()}
      </Text>
    ) : (
      <Stack gap="md" mt="md">
        {project.branches.map((branch) => (
          <Box key={branch.key} data-testid="overview-branch" data-key={branch.key}>
            <Group justify="space-between" gap="xs" mb={6} wrap="nowrap">
              <Text size="sm" fw={600} truncate>
                {asI18n(branch.label)}
              </Text>
              <Anchor
                size="xs"
                style={{ flex: 'none' }}
                renderRoot={(props) => (
                  <Link
                    to="/app/projects/$projectId/report"
                    params={{ projectId: project.projectId }}
                    search={{ branch: branch.key }}
                    {...props}
                  />
                )}
              >
                {m.home__open_report()}
              </Anchor>
            </Group>
            <SummaryBar summary={branch.summary} screens={branch.screens} size="sm" />
            {branch.worst ? (
              <Group gap={6} mt={8} wrap="nowrap">
                <Text size="xs" c="dimmed" style={{ flex: 'none' }}>
                  {m.home__worst()}
                </Text>
                <Anchor
                  size="xs"
                  ff="monospace"
                  truncate
                  renderRoot={(props) => (
                    <Link
                      to="/app/projects/$projectId/routes/$routeKey"
                      params={{ projectId: project.projectId, routeKey: branch.worst!.routeKey }}
                      search={{
                        branch: branch.key,
                        state: branch.worst!.stateKey,
                        viewport: branch.worst!.viewportKey,
                      }}
                      {...props}
                    />
                  )}
                >
                  {asI18n(`${branch.worst.routeKey} · ${branch.worst.viewportKey}`)}
                </Anchor>
                <Text size="xs" fw={600} c="red" ff="monospace" style={{ flex: 'none' }}>
                  {asI18n(percent(branch.worst.diffRatio))}
                </Text>
              </Group>
            ) : null}
          </Box>
        ))}
      </Stack>
    )}
  </Card>
)

/**
 * Home — where every rebuild stands.
 *
 * The question someone opens diffui with is "which rebuild needs me", so this
 * is the answer at a glance: totals across the organisation, then each recently
 * active project with a bar per rebuild and a link straight to its worst
 * screen. Counts and bars, never one blended percentage — a rebuild that has
 * pushed three screens out of two hundred must not look finished.
 */
export const HomePage: FC = () => {
  useLocale()
  const overview = usePikkuQuery('overview', {})
  const data = overview.data

  const branches = data?.projects.flatMap((project) => project.branches) ?? []
  const scored = branches.reduce((sum, branch) => sum + branch.summary.scored, 0)
  const different = branches.reduce((sum, branch) => sum + branch.summary.different, 0)

  return (
    <Box maw={1080} w="100%" mx="auto" data-testid="home">
      <PageHeader
        title={m.home__title()}
        description={m.home__description()}
        actions={
          data && data.projectCount > 0 ? (
            <Button
              variant="default"
              size="sm"
              leftSection={<ProjectsGlyph size={16} />}
              renderRoot={(props) => <Link to="/app/projects" {...props} />}
            >
              {m.home__all_projects()}
            </Button>
          ) : null
        }
      />

      {overview.isLoading ? (
        <Stack gap="md">
          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} height={84} radius="lg" />
            ))}
          </SimpleGrid>
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
            <Skeleton height={180} radius="lg" />
            <Skeleton height={180} radius="lg" />
          </SimpleGrid>
        </Stack>
      ) : !data || data.projectCount === 0 ? (
        <Card withBorder radius="lg" padding="xl" data-testid="home-empty">
          <Stack gap="sm" align="center" ta="center" py="lg">
            <ThemeIcon size={44} radius="xl" variant="light" color="gray">
              <ProjectsGlyph size={22} />
            </ThemeIcon>
            <Text fw={650} fz="lg">
              {m.home__empty_title()}
            </Text>
            <Text c="dimmed" size="sm" maw={460} style={{ lineHeight: 1.55 }}>
              {m.home__empty_hint()}
            </Text>
            <Button mt="xs" renderRoot={(props) => <Link to="/app/projects" {...props} />}>
              {m.home__empty_cta()}
            </Button>
          </Stack>
        </Card>
      ) : (
        <Stack gap="lg">
          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
            <Stat
              label={m.home__stat_projects()}
              value={data.projectCount}
              testId="stat-projects"
            />
            <Stat label={m.home__stat_rebuilds()} value={branches.length} testId="stat-rebuilds" />
            <Stat label={m.home__stat_scored()} value={scored} testId="stat-scored" />
            <Stat
              label={m.home__stat_different()}
              value={different}
              tone={different > 0 ? 'red' : undefined}
              testId="stat-different"
            />
          </SimpleGrid>

          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md" data-testid="overview-projects">
            {data.projects.map((project) => (
              <ProjectCard key={project.projectId} project={project} />
            ))}
          </SimpleGrid>

          {data.projectCount > data.projects.length ? (
            <Text size="xs" c="dimmed" ta="center">
              {m.home__showing({ shown: data.projects.length, total: data.projectCount })}
            </Text>
          ) : null}
        </Stack>
      )}
    </Box>
  )
}
