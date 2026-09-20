import type { FC } from 'react'
import {
  Badge,
  Box,
  Card,
  Group,
  Image,
  ScrollArea,
  Skeleton,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from '@pikku/mantine/core'
import { useParams } from '@tanstack/react-router'
import { usePikkuQuery } from '@project/functions-sdk/pikku/api.gen'
import { m, asI18n } from '@/i18n/messages'
import { useLocale } from '@/i18n/config'

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

/**
 * One project's routes, each with what is known about it on the legacy side.
 *
 * A path is rendered as the monospace string it is — these are URLs an engineer
 * compares by eye against two running apps, and proportional type makes
 * `/#/product-library/:id` genuinely harder to read.
 */
export const ProjectRoutesPage: FC = () => {
  useLocale()
  const { projectId } = useParams({ from: '/app/projects/$projectId' })

  const project = usePikkuQuery('getProject', { projectId })
  const routes = usePikkuQuery('listRoutes', { projectId })
  const shots = usePikkuQuery('listShots', { projectId })

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
      <Title order={1} fz={24} fw={650} style={{ letterSpacing: '-0.025em' }}>
        {project.data ? asI18n(project.data.project.name) : m.common__loading()}
      </Title>
      <Text c="dimmed" size="sm" mt={6} style={{ lineHeight: 1.55 }}>
        {m.project__routes_description()}
      </Text>

      <Group gap={6} mt="md" mb="lg">
        {(project.data?.viewports ?? []).map((viewport) => (
          <Badge
            key={viewport.viewportId}
            variant="default"
            size="sm"
            data-testid="project-viewport"
          >
            {asI18n(`${viewport.label} ${viewport.width}×${viewport.height}`)}
          </Badge>
        ))}
        {coverage ? (
          <>
            <Badge variant="light" size="sm" data-testid="coverage-present">
              {asI18n(`${coverage.present} ${m.coverage__present()}`)}
            </Badge>
            <Badge variant="light" size="sm" color="yellow" data-testid="coverage-unmapped">
              {asI18n(`${coverage.unmapped} ${m.coverage__unmapped()}`)}
            </Badge>
          </>
        ) : null}
      </Group>

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
        /* The table is the one thing allowed to overflow sideways — three paths
           will not fit a phone, and truncating a URL makes it unreadable. */
        <Card withBorder radius="lg" padding={0}>
          <ScrollArea type="auto">
            <Table striped highlightOnHover miw={720} data-testid="routes-table">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{m.project__col_route()}</Table.Th>
                  <Table.Th>{m.project__col_legacy()}</Table.Th>
                  <Table.Th>{m.project__col_new()}</Table.Th>
                  <Table.Th>{m.project__col_coverage()}</Table.Th>
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
                        </Stack>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" ff="monospace" c={route.legacyPath ? undefined : 'dimmed'}>
                          {asI18n(route.legacyPath ?? '—')}
                        </Text>
                      </Table.Td>
                      <Table.Td>
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
                      <Table.Td>
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
                            <Badge size="sm" variant="light" data-testid="baseline-badge">
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
