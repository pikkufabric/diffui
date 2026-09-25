import type { FC } from 'react'
import {
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Image,
  ScrollArea,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  Tooltip,
} from '@pikku/mantine/core'
import { Link, useParams } from '@tanstack/react-router'
import { usePikkuQuery } from '@project/functions-sdk/pikku/api.gen'
import { m, asI18n } from '@/i18n/messages'
import { useLocale } from '@/i18n/config'
import { CrumbAnchor, PageHeader } from '@/components/PageHeader'
import { SummaryBar } from '@/components/diff/SummaryBar'

type Coverage = 'present' | 'absent' | 'unmapped'

/**
 * How each legacy coverage state reads.
 *
 * THREE states, deliberately — see knowledge/entities/route.md. `unmapped` is an
 * open question and `absent` is a stated fact, and showing them the same way is
 * how a report claims a rebuild is finished when nobody has checked. So they get
 * different words, different weight, and a tooltip each saying which is which.
 */
const COVERAGE: Record<
  Coverage,
  {
    label: () => ReturnType<typeof m.coverage__present>
    hint: () => ReturnType<typeof m.coverage__present>
    color: string
  }
> = {
  present: { label: m.coverage__present, hint: m.coverage__present_hint, color: 'gray' },
  absent: { label: m.coverage__absent, hint: m.coverage__absent_hint, color: 'dark' },
  unmapped: { label: m.coverage__unmapped, hint: m.coverage__unmapped_hint, color: 'yellow' },
}

/** One rebuild's standing, linking to its report — the project's "how far along" at a glance. */
const RebuildCard: FC<{ projectId: string; branch: { key: string; label: string } }> = ({
  projectId,
  branch,
}) => {
  const report = usePikkuQuery('projectReport', { projectId, branchKey: branch.key })
  return (
    <Card withBorder radius="lg" padding="md" data-testid="project-rebuild" data-key={branch.key}>
      <Group justify="space-between" mb="xs" wrap="nowrap" gap="xs">
        <Text fw={600} size="sm" truncate>
          {asI18n(branch.label)}
        </Text>
        <Anchor
          size="xs"
          style={{ flex: 'none' }}
          renderRoot={(props) => (
            <Link
              to="/app/projects/$projectId/report"
              params={{ projectId }}
              search={{ branch: branch.key }}
              {...props}
            />
          )}
        >
          {m.report__view()}
        </Anchor>
      </Group>
      {report.data ? (
        <>
          <Text size="xs" c="dimmed" mb={6}>
            {m.summary__scored({
              scored: report.data.summary.scored,
              screens: report.data.rows.length,
            })}
          </Text>
          <SummaryBar summary={report.data.summary} screens={report.data.rows.length} size="sm" />
        </>
      ) : (
        <Skeleton height={8} radius="xl" />
      )}
    </Card>
  )
}

/**
 * One project's routes, each with what is known about it on the legacy side.
 *
 * A path is rendered as the monospace string it is — these are URLs an engineer
 * compares by eye against two running apps, and proportional type makes
 * `/#/product-library/:id` genuinely harder to read.
 */
export const ProjectRoutesPage: FC = () => {
  useLocale()
  const { projectId } = useParams({ from: '/app/projects/$projectId/' })

  const project = usePikkuQuery('getProject', { projectId })
  const routes = usePikkuQuery('listRoutes', { projectId })
  const shots = usePikkuQuery('listShots', { projectId })
  const branches = usePikkuQuery('listBranches', { projectId })

  /* A project in another organisation and a project that does not exist fail the
     same way, and say the same thing — a distinguishable "no such project" tells
     an outsider which ids are real. */
  if (project.isError) {
    return (
      <Box maw={880} w="100%" mx="auto">
        <Card withBorder radius="lg" padding="xl" data-testid="project-not-found">
          <Stack gap={4} align="center">
            <Text fw={600}>{m.project__not_found()}</Text>
            <Text c="dimmed" size="sm">
              {m.project__not_found_hint()}
            </Text>
          </Stack>
        </Card>
      </Box>
    )
  }

  const rows = routes.data?.routes ?? []
  const coverage = routes.data?.coverage

  /* The pinned baseline per route, not "the newest shot" — which shot everyone
     is measured against is a decision the CLI recorded (`is_baseline`), and this
     reads that decision back. Desktop is preferred only as the one thumbnail a
     row has space for; every resolution's baseline is still listed by listShots. */
  const baselines = new Map<string, NonNullable<typeof shots.data>['shots'][number]>()
  for (const shot of shots.data?.shots ?? []) {
    if (shot.side !== 'legacy' || !shot.isBaseline) continue
    const current = baselines.get(shot.routeKey)
    if (!current || shot.viewportKey === 'desktop') baselines.set(shot.routeKey, shot)
  }

  return (
    <Box maw={1080} w="100%" mx="auto" data-testid="project-detail">
      <PageHeader
        crumbs={[
          {
            label: m.nav__projects(),
            render: (label) => (
              <CrumbAnchor renderRoot={(props) => <Link to="/app/projects" {...props} />}>
                {label}
              </CrumbAnchor>
            ),
          },
        ]}
        title={project.data ? asI18n(project.data.project.name) : m.common__loading()}
        description={m.project__routes_description()}
        actions={
          <Button
            variant="light"
            size="sm"
            data-testid="project-report-open"
            renderRoot={(props) => (
              <Link to="/app/projects/$projectId/report" params={{ projectId }} {...props} />
            )}
          >
            {m.report__view()}
          </Button>
        }
      />

      <Group gap={6} mb="lg">
        <Text size="xs" c="dimmed" mr={2}>
          {m.project__viewports_label()}
        </Text>
        {(project.data?.viewports ?? []).map((viewport) => (
          <Badge
            key={viewport.viewportId}
            variant="default"
            size="sm"
            radius="sm"
            tt="none"
            fw={500}
            data-testid="project-viewport"
          >
            {asI18n(`${viewport.label} ${viewport.width}×${viewport.height}`)}
          </Badge>
        ))}
        {coverage ? (
          <>
            <Badge
              variant="light"
              size="sm"
              radius="sm"
              tt="none"
              fw={500}
              data-testid="coverage-present"
            >
              {asI18n(`${coverage.present} ${m.coverage__present()}`)}
            </Badge>
            {/* Only when there is something unanswered: "0 not mapped" in a warning
                colour reads as a problem that is not there. */}
            {coverage.unmapped > 0 ? (
              <Badge
                variant="light"
                size="sm"
                radius="sm"
                tt="none"
                fw={500}
                color="yellow"
                data-testid="coverage-unmapped"
              >
                {asI18n(`${coverage.unmapped} ${m.coverage__unmapped()}`)}
              </Badge>
            ) : null}
          </>
        ) : null}
      </Group>

      <Text fw={600} mb="xs">
        {m.project__rebuilds_title()}
      </Text>
      {branches.data && branches.data.branches.length > 0 ? (
        <SimpleGrid
          cols={{ base: 1, sm: 2, md: 3 }}
          spacing="md"
          mb="xl"
          data-testid="project-rebuilds"
        >
          {branches.data.branches.map((branch) => (
            <RebuildCard key={branch.branchId} projectId={projectId} branch={branch} />
          ))}
        </SimpleGrid>
      ) : (
        <Text size="sm" c="dimmed" mb="xl">
          {branches.isLoading ? m.common__loading() : m.project__rebuilds_empty()}
        </Text>
      )}

      <Text fw={600} mb="xs">
        {m.project__routes_title()}
      </Text>
      {routes.isLoading ? (
        <Stack gap="sm">
          <Skeleton height={44} radius="md" />
          <Skeleton height={44} radius="md" />
        </Stack>
      ) : rows.length === 0 ? (
        <Card withBorder radius="lg" padding="xl" data-testid="routes-empty">
          <Stack gap={4} align="center">
            <Text fw={600}>{m.project__routes_empty_title()}</Text>
            <Text c="dimmed" size="sm" ta="center">
              {m.project__routes_empty_hint()}
            </Text>
          </Stack>
        </Card>
      ) : (
        /* Below `md` the two path columns fold into the route cell, so the table
           fits a phone; the scroll area stays for a very long key. */
        <Card withBorder radius="lg" padding={0}>
          <ScrollArea type="auto">
            <Table striped highlightOnHover data-testid="routes-table">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{m.project__col_route()}</Table.Th>
                  <Table.Th visibleFrom="md">{m.project__col_legacy()}</Table.Th>
                  <Table.Th visibleFrom="md">{m.project__col_new()}</Table.Th>
                  <Table.Th visibleFrom="sm">{m.project__col_coverage()}</Table.Th>
                  <Table.Th>{m.project__col_baseline()}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((route) => {
                  const state = COVERAGE[route.legacyCoverage as Coverage]
                  const baseline = baselines.get(route.key)
                  return (
                    <Table.Tr key={route.routeId} data-testid="route-row" data-key={route.key}>
                      <Table.Td>
                        <Stack gap={0}>
                          <Text fw={600} size="sm" data-testid="route-label">
                            {asI18n(route.label)}
                          </Text>
                          <Text c="dimmed" size="xs" ff="monospace" data-testid="route-key">
                            {asI18n(route.key)}
                          </Text>
                          {/* The paths columns do not fit a phone; the legacy path,
                              the one an engineer checks against, moves in here. */}
                          {route.legacyPath ? (
                            <Text
                              c="dimmed"
                              size="xs"
                              ff="monospace"
                              hiddenFrom="md"
                              style={{ overflowWrap: 'anywhere' }}
                            >
                              {asI18n(route.legacyPath)}
                            </Text>
                          ) : null}
                        </Stack>
                      </Table.Td>
                      <Table.Td visibleFrom="md">
                        <Text size="xs" ff="monospace" c={route.legacyPath ? undefined : 'dimmed'}>
                          {asI18n(route.legacyPath ?? '—')}
                        </Text>
                      </Table.Td>
                      <Table.Td visibleFrom="md">
                        {route.newPath ? (
                          <Text size="xs" ff="monospace">
                            {asI18n(route.newPath)}
                          </Text>
                        ) : (
                          /* No score, because nothing has been built — a gap is
                             never rendered as a percentage. */
                          <Badge size="sm" variant="outline" data-testid="route-not-built">
                            {m.coverage__not_built()}
                          </Badge>
                        )}
                      </Table.Td>
                      <Table.Td visibleFrom="sm">
                        <Tooltip label={state.hint()} withArrow position="left">
                          <Badge
                            size="sm"
                            color={state.color}
                            variant={route.legacyCoverage === 'unmapped' ? 'light' : 'default'}
                            data-testid="route-coverage"
                            data-coverage={route.legacyCoverage}
                          >
                            {state.label()}
                          </Badge>
                        </Tooltip>
                      </Table.Td>
                      <Table.Td>
                        {baseline ? (
                          <Group gap="xs" wrap="nowrap">
                            <Image
                              src={baseline.assetUrl}
                              alt={m.baseline__image_alt()}
                              w={56}
                              h={40}
                              fit="cover"
                              radius="sm"
                              data-testid="baseline-shot"
                            />
                            <Badge
                              size="sm"
                              variant="light"
                              visibleFrom="sm"
                              data-testid="baseline-badge"
                            >
                              {m.baseline__badge()}
                            </Badge>
                          </Group>
                        ) : (
                          <Text size="xs" c="dimmed" data-testid="baseline-missing">
                            {m.baseline__missing()}
                          </Text>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Card>
      )}
    </Box>
  )
}
