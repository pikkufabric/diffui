import type { FC } from 'react'
import {
  Anchor,
  Box,
  Card,
  Divider,
  Group,
  Progress,
  SegmentedControl,
  Skeleton,
  Stack,
  Text,
} from '@pikku/mantine/core'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { usePikkuQuery } from '@project/functions-sdk/pikku/api.gen'
import { m, asI18n } from '@/i18n/messages'
import { useLocale } from '@/i18n/config'
import { CrumbAnchor, PageHeader } from '@/components/PageHeader'
import { StatusBadge } from '@/components/diff/StatusBadge'
import { SummaryBar } from '@/components/diff/SummaryBar'
import { GAP, SCORED, percent } from '@/components/diff/status'

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

/** Different first (worst ratio first), then the wrong-width ones, then matches. */
const RANK: Record<string, number> = { different: 0, 'size-mismatch': 1, identical: 2 }

/** The order the gap kinds are listed in: the ones a rebuild team can act on first. */
const GAP_ORDER = ['not-built', 'no-baseline', 'unmapped', 'legacy-absent'] as const

const coordinate = (row: Row) => asI18n(`${row.routeKey} · ${row.stateKey} · ${row.viewportKey}`)

/**
 * The report: how far the rebuild is, and what nobody has built, kept apart.
 *
 * Two questions, never one number (`the-report-answers-two-questions`). A branch
 * that matched the three screens it pushed is not finished, so the breakdown bar
 * draws the unscored share too; the scored screens are listed worst first with
 * the pixel count each score was taken over; and the gaps are listed by kind,
 * each with what to do about it — never as a score of zero.
 */
export const ReportPage: FC = () => {
  useLocale()
  const { projectId } = routeApi.useParams()
  const search = routeApi.useSearch()
  const navigate = useNavigate()

  const project = usePikkuQuery('getProject', { projectId })
  const branches = usePikkuQuery('listBranches', { projectId })
  const branchKey = search.branch ?? branches.data?.branches[0]?.key ?? ''

  const report = usePikkuQuery(
    'projectReport',
    { projectId, branchKey },
    { enabled: branchKey !== '' },
  )

  const rows: Row[] = (report.data?.rows ?? []) as Row[]
  const scored = rows.filter((row) => SCORED.has(row.status))
  scored.sort(
    (a, b) =>
      (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9) || (b.diffRatio ?? 0) - (a.diffRatio ?? 0),
  )
  const gaps = GAP_ORDER.map((kind) => ({
    kind,
    rows: rows.filter((row) => row.status === kind),
  })).filter((group) => group.rows.length > 0)

  const projectName = project.data ? asI18n(project.data.project.name) : m.common__loading()

  return (
    <Box maw={1080} w="100%" mx="auto" data-testid="report">
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
          {
            label: projectName,
            render: (label) => (
              <CrumbAnchor
                renderRoot={(props) => (
                  <Link
                    to="/app/projects/$projectId"
                    params={{ projectId }}
                    data-testid="report-routes-link"
                    {...props}
                  />
                )}
              >
                {label}
              </CrumbAnchor>
            ),
          },
        ]}
        title={m.report__title()}
        description={m.report__description()}
      />

      {branches.isLoading ? (
        <Skeleton height={36} radius="md" mb="lg" />
      ) : branches.data && branches.data.branches.length > 0 ? (
        <Group gap="sm" mb="md" data-testid="report-branches">
          <Text size="sm" c="dimmed">
            {m.report__branch()}
          </Text>
          {/* A choice only when there is one to make; a lone rebuild is just named. */}
          {branches.data.branches.length > 1 ? (
            <SegmentedControl
              size="sm"
              radius="md"
              value={branchKey}
              onChange={(key) => navigate({ to: '.', search: { branch: key }, replace: true })}
              data={branches.data.branches.map((branch) => ({
                value: branch.key,
                label: asI18n(branch.label),
              }))}
            />
          ) : (
            <Text size="sm" fw={600} data-testid="report-branch" data-key={branchKey}>
              {asI18n(branches.data.branches[0]!.label)}
            </Text>
          )}
        </Group>
      ) : (
        <Card withBorder radius="lg" padding="xl" data-testid="report-empty">
          <Text fw={600}>{m.report__no_rebuilds_title()}</Text>
          <Text c="dimmed" size="sm" mt={4}>
            {m.report__no_rebuilds_hint()}
          </Text>
        </Card>
      )}

      {report.isLoading ? (
        <Stack gap="sm">
          <Skeleton height={96} radius="lg" />
          <Skeleton height={56} radius="lg" />
          <Skeleton height={56} radius="lg" />
        </Stack>
      ) : report.data ? (
        <Stack gap="lg">
          <Card withBorder radius="lg" padding="lg" data-testid="report-summary">
            <Text fw={600} mb="sm" data-testid="report-scored-count">
              {m.summary__scored({ scored: report.data.summary.scored, screens: rows.length })}
            </Text>
            <SummaryBar summary={report.data.summary} screens={rows.length} />
          </Card>

          {scored.length > 0 ? (
            <Card withBorder radius="lg" padding={0} data-testid="report-scored">
              <Group
                px="lg"
                py="sm"
                justify="space-between"
                visibleFrom="sm"
                style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}
              >
                <Text size="xs" c="dimmed" fw={600}>
                  {m.report__col_route()}
                </Text>
                <Text size="xs" c="dimmed" fw={600}>
                  {m.report__col_score()}
                </Text>
              </Group>
              <Stack gap={0} data-testid="report-table">
                {scored.map((row, i) => (
                  <Box key={`${row.routeKey}/${row.stateKey}/${row.viewportKey}`}>
                    {i > 0 ? <Divider /> : null}
                    <Group
                      px="lg"
                      py="sm"
                      justify="space-between"
                      gap="sm"
                      data-testid="report-row"
                      data-key={row.routeKey}
                    >
                      <Stack gap={2} style={{ flex: '1 1 240px', minWidth: 0 }}>
                        <Anchor
                          fw={600}
                          size="sm"
                          c="var(--mantine-color-text)"
                          underline="hover"
                          data-testid="report-open-route"
                          data-key={row.routeKey}
                          renderRoot={(props) => (
                            <Link
                              to="/app/projects/$projectId/routes/$routeKey"
                              params={{ projectId, routeKey: row.routeKey }}
                              search={{
                                branch: branchKey,
                                state: row.stateKey,
                                viewport: row.viewportKey,
                              }}
                              {...props}
                            />
                          )}
                        >
                          <Stack gap={0}>
                            <span>{asI18n(row.routeLabel)}</span>
                            <Text span c="dimmed" size="xs" ff="monospace" fw={400}>
                              {coordinate(row)}
                            </Text>
                          </Stack>
                        </Anchor>
                      </Stack>
                      <Group gap="md" wrap="nowrap" style={{ flex: 'none' }}>
                        <StatusBadge status={row.status} testId="report-status" />
                        {row.status === 'size-mismatch' || row.diffRatio == null ? (
                          /* Not a percentage: a capture at the wrong width has a
                             problem, and a number would hide it among the scores. */
                          <Text size="sm" c="dimmed" ff="monospace" w={180} ta="right">
                            {asI18n('—')}
                          </Text>
                        ) : (
                          <Stack gap={4} w={180} align="flex-end">
                            <Text size="sm" fw={600} ff="monospace" data-testid="report-score">
                              {asI18n(percent(row.diffRatio))}
                            </Text>
                            <Progress
                              w="100%"
                              size={4}
                              radius="xl"
                              color={row.status === 'identical' ? 'teal' : 'red'}
                              value={Math.max(row.diffRatio * 100, row.diffRatio > 0 ? 2 : 0)}
                              aria-label={asI18n(percent(row.diffRatio))}
                            />
                            <Text
                              size="xs"
                              c="dimmed"
                              ff="monospace"
                              style={{ whiteSpace: 'nowrap' }}
                            >
                              {asI18n(
                                `${(row.diffPixels ?? 0).toLocaleString()} / ${(row.comparedPixels ?? 0).toLocaleString()}`,
                              )}
                            </Text>
                          </Stack>
                        )}
                      </Group>
                    </Group>
                  </Box>
                ))}
              </Stack>
            </Card>
          ) : (
            <Card withBorder radius="lg" padding="lg">
              <Text c="dimmed" size="sm">
                {m.report__nothing_scored()}
              </Text>
            </Card>
          )}

          {gaps.length > 0 ? (
            <Card withBorder radius="lg" padding="lg" data-testid="report-gaps">
              <Text fw={600}>{m.report__gaps_title()}</Text>
              <Text c="dimmed" size="sm" mt={4} mb="md" maw={720}>
                {m.report__gaps_hint()}
              </Text>
              <Stack gap="lg">
                {gaps.map((group) => (
                  <Box key={group.kind} data-testid="report-gap-group" data-kind={group.kind}>
                    <Group gap="xs" mb={4}>
                      <StatusBadge status={group.kind} />
                      <Text size="sm" fw={600}>
                        {GAP[group.kind].title()}
                      </Text>
                      <Text size="sm" c="dimmed">
                        {asI18n(`(${group.rows.length})`)}
                      </Text>
                    </Group>
                    <Text size="xs" c="dimmed" mb={8}>
                      {GAP[group.kind].hint()}
                    </Text>
                    <Stack gap={2}>
                      {group.rows.map((row) => (
                        <Text
                          key={`${row.routeKey}/${row.stateKey}/${row.viewportKey}`}
                          size="sm"
                          ff="monospace"
                          style={{ overflowWrap: 'anywhere' }}
                          data-testid="report-gap"
                          data-key={row.routeKey}
                        >
                          {coordinate(row)}
                        </Text>
                      ))}
                    </Stack>
                  </Box>
                ))}
              </Stack>
            </Card>
          ) : rows.length > 0 ? (
            <Text size="sm" c="dimmed" ta="center">
              {m.report__all_scored()}
            </Text>
          ) : null}
        </Stack>
      ) : null}
    </Box>
  )
}
