import { useState } from 'react'
import type { FC } from 'react'
import {
  Badge,
  Box,
  Button,
  Card,
  Group,
  Skeleton,
  Stack,
  Table,
  Text,
  Title,
} from '@pikku/mantine/core'
import { getRouteApi, Link } from '@tanstack/react-router'
import { usePikkuQuery } from '@project/functions-sdk/pikku/api.gen'
import { m, asI18n } from '@/i18n/messages'
import { useLocale } from '@/i18n/config'

const routeApi = getRouteApi('/app/projects/$projectId/report')

type Row = {
  routeKey: string
  routeLabel: string
  stateKey: string
  viewportKey: string
  status: string
  diffPixels: number | null
  comparedPixels: number | null
  diffRatio: number | null
}

/** The three verdicts that are a MEASUREMENT; everything else is a gap. */
const SCORED = new Set(['identical', 'different', 'size-mismatch'])

/**
 * How each verdict reads.
 *
 * `size-mismatch` is deliberately not rendered as a percentage — a rebuild
 * captured at the wrong resolution has a problem, and giving it a score would
 * hide that behind a number that looks like every other number.
 */
const STATUS: Record<
  string,
  { label: () => ReturnType<typeof m.status__different>; color: string }
> = {
  identical: { label: m.status__identical, color: 'teal' },
  different: { label: m.status__different, color: 'red' },
  'size-mismatch': { label: m.status__size_mismatch, color: 'orange' },
  'not-built': { label: m.status__not_built, color: 'gray' },
  'no-baseline': { label: m.status__no_baseline, color: 'yellow' },
  'legacy-absent': { label: m.status__legacy_absent, color: 'dark' },
  unmapped: { label: m.status__unmapped, color: 'yellow' },
}

/** Different first (worst ratio first), then the wrong-size ones, then matches. */
const RANK: Record<string, number> = { different: 0, 'size-mismatch': 1, identical: 2 }

const percent = (row: Row) => (row.diffRatio == null ? '' : `${(row.diffRatio * 100).toFixed(2)}%`)

/**
 * The report: how far the rebuild is, and what nobody has built, kept apart.
 *
 * Two questions, never one number (`the-report-answers-two-questions`). A branch
 * that matched the three routes it pushed is not finished, so the scored routes
 * are listed worst first with the count each score was taken over, and the
 * unbuilt routes are listed separately as gaps — never as a score of zero.
 */
export const ReportPage: FC = () => {
  useLocale()
  const { projectId } = routeApi.useParams()

  const branches = usePikkuQuery('listBranches', { projectId })
  const [chosen, setChosen] = useState<string>()
  const branchKey = chosen ?? branches.data?.branches[0]?.key ?? ''

  const report = usePikkuQuery(
    'projectReport',
    { projectId, branchKey },
    { enabled: branchKey !== '' },
  )

  const rows: Row[] = (report.data?.rows ?? []) as Row[]
  const scored = rows.filter((row) => SCORED.has(row.status))
  const gaps = rows.filter((row) => !SCORED.has(row.status))
  scored.sort(
    (a, b) =>
      (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9) || (b.diffRatio ?? 0) - (a.diffRatio ?? 0),
  )

  return (
    <Box maw={1080} w="100%" mx="auto" data-testid="report">
      <Title order={1} fz={24} fw={650} style={{ letterSpacing: '-0.025em' }}>
        {m.report__title()}
      </Title>
      <Text c="dimmed" size="sm" mt={6} mb="md" style={{ lineHeight: 1.55 }}>
        {m.report__description()}
      </Text>

      {branches.isLoading ? (
        <Skeleton height={36} radius="md" mb="lg" />
      ) : branches.data && branches.data.branches.length > 0 ? (
        <Group gap={6} mb="lg" data-testid="report-branches">
          <Text size="sm" c="dimmed">
            {m.report__branch()}
          </Text>
          {branches.data.branches.map((branch) => (
            <Button
              key={branch.branchId}
              size="compact-sm"
              variant={branch.key === branchKey ? 'filled' : 'light'}
              data-testid="report-branch"
              data-key={branch.key}
              onClick={() => setChosen(branch.key)}
            >
              {asI18n(branch.label)}
            </Button>
          ))}
        </Group>
      ) : (
        <Card withBorder radius="lg" padding="xl" mb="lg" data-testid="report-empty">
          <Text fw={600}>{m.report__gaps_title()}</Text>
          <Text c="dimmed" size="sm" mt={4}>
            {m.report__gaps_hint()}
          </Text>
        </Card>
      )}

      {report.data ? (
        <Group gap={6} mb="lg">
          <Badge variant="light" size="lg" data-testid="report-scored-count">
            {asI18n(
              `${report.data.summary.scored} ${m.report__scored()} ${m.report__of()} ${
                rows.length
              } ${m.report__routes()}`,
            )}
          </Badge>
          <Badge variant="default" size="lg">
            {asI18n(`${report.data.summary.identical} ${m.status__identical()}`)}
          </Badge>
          <Badge variant="light" color="red" size="lg">
            {asI18n(`${report.data.summary.different} ${m.status__different()}`)}
          </Badge>
        </Group>
      ) : null}

      {report.isLoading ? (
        <Stack gap="sm">
          <Skeleton height={44} radius="md" />
          <Skeleton height={44} radius="md" />
        </Stack>
      ) : (
        <>
          <Card withBorder radius="lg" padding={0} mb="lg" data-testid="report-scored">
            <Table striped highlightOnHover data-testid="report-table">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{m.report__col_route()}</Table.Th>
                  <Table.Th>{m.report__col_status()}</Table.Th>
                  <Table.Th>{m.report__col_score()}</Table.Th>
                  <Table.Th>{m.report__col_compared()}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {scored.map((row) => {
                  const status = STATUS[row.status]
                  return (
                    <Table.Tr
                      key={`${row.routeKey}/${row.stateKey}/${row.viewportKey}`}
                      data-testid="report-row"
                      data-key={row.routeKey}
                    >
                      <Table.Td>
                        <Link
                          to="/app/projects/$projectId/routes/$routeKey"
                          params={{ projectId, routeKey: row.routeKey }}
                          search={{
                            branch: branchKey,
                            state: row.stateKey,
                            viewport: row.viewportKey,
                          }}
                          data-testid="report-open-route"
                          data-key={row.routeKey}
                        >
                          <Stack gap={0}>
                            <Text fw={600} size="sm">
                              {asI18n(row.routeLabel)}
                            </Text>
                            <Text c="dimmed" size="xs" ff="monospace">
                              {asI18n(`${row.routeKey} · ${row.stateKey} · ${row.viewportKey}`)}
                            </Text>
                          </Stack>
                        </Link>
                      </Table.Td>
                      <Table.Td>
                        <Badge
                          size="sm"
                          color={status.color}
                          variant="light"
                          data-testid="report-status"
                        >
                          {status.label()}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" ff="monospace" data-testid="report-score">
                          {asI18n(percent(row))}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed" ff="monospace">
                          {asI18n(
                            row.comparedPixels == null ? '—' : row.comparedPixels.toLocaleString(),
                          )}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          </Card>

          {gaps.length > 0 ? (
            <Card withBorder radius="lg" padding="lg" data-testid="report-gaps">
              <Text fw={600}>{m.report__gaps_title()}</Text>
              <Text c="dimmed" size="sm" mt={4} mb="sm">
                {m.report__gaps_hint()}
              </Text>
              <Stack gap={4}>
                {gaps.map((row) => {
                  const status = STATUS[row.status]
                  return (
                    <Group
                      key={`${row.routeKey}/${row.stateKey}/${row.viewportKey}`}
                      justify="space-between"
                      data-testid="report-gap"
                      data-key={row.routeKey}
                    >
                      <Text size="sm" ff="monospace">
                        {asI18n(`${row.routeKey} · ${row.stateKey} · ${row.viewportKey}`)}
                      </Text>
                      <Badge size="sm" color={status.color} variant="light">
                        {status.label()}
                      </Badge>
                    </Group>
                  )
                })}
              </Stack>
            </Card>
          ) : null}
        </>
      )}

      <Group mt="lg">
        <Button
          variant="subtle"
          size="sm"
          data-testid="report-routes-link"
          renderRoot={(props) => (
            <Link to="/app/projects/$projectId/" params={{ projectId }} {...props} />
          )}
        >
          {m.project__routes_title()}
        </Button>
      </Group>
    </Box>
  )
}
