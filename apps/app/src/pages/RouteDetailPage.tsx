import { useState } from 'react'
import type { FC } from 'react'
import type { I18nString } from '@pikku/react'
import {
  Anchor,
  Box,
  Card,
  Group,
  Image,
  SegmentedControl,
  SimpleGrid,
  Skeleton,
  Slider,
  Stack,
  Text,
} from '@pikku/mantine/core'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { usePikkuQuery } from '@project/functions-sdk/pikku/api.gen'
import { m, asI18n } from '@/i18n/messages'
import { useLocale } from '@/i18n/config'
import { CrumbAnchor, PageHeader } from '@/components/PageHeader'
import { StatusBadge } from '@/components/diff/StatusBadge'
import { percent } from '@/components/diff/status'

const routeApi = getRouteApi('/app/projects/$projectId/routes/$routeKey')

type Region = {
  kind: 'changed' | 'added' | 'removed'
  baseline: { y: number; height: number }
  target: { y: number; height: number }
}

/** The tints the diff image paints these regions in (lib/diff.ts), so the list and the picture agree. */
const REGION: Record<Region['kind'], { label: () => I18nString; color: string }> = {
  changed: { label: m.route__region_changed, color: 'red' },
  added: { label: m.route__region_added, color: 'green' },
  removed: { label: m.route__region_removed, color: 'orange' },
}

/** One image, opened full size in a new tab on click — a thumbnail hides exactly the detail a diff is about. */
const Panel: FC<{
  label: I18nString
  src?: string | null
  testId: string
  empty: I18nString
}> = ({ label, src, testId, empty }) => (
  <Card withBorder radius="lg" padding="sm">
    <Stack gap="xs">
      <Text fw={600} size="sm">
        {label}
      </Text>
      {src ? (
        <Anchor href={src} target="_blank" rel="noreferrer" aria-label={label}>
          <Image
            src={src}
            alt={label}
            fit="contain"
            mah={560}
            radius="sm"
            data-testid={testId}
            style={{ background: 'var(--mantine-color-default-hover)' }}
          />
        </Anchor>
      ) : (
        <Box
          p="lg"
          style={{
            borderRadius: 'var(--mantine-radius-sm)',
            border: '1px dashed var(--mantine-color-default-border)',
          }}
        >
          <Text c="dimmed" size="sm" ta="center" data-testid={`${testId}-empty`}>
            {empty}
          </Text>
        </Box>
      )}
    </Stack>
  </Card>
)

/**
 * Legacy and the rebuild on top of each other, split by a slider.
 *
 * Only offered when the two are the same size: sliding across images of
 * different heights lines up nothing and would suggest differences that are
 * only the pages scrolling apart. The side-by-side view and the regions below
 * cover that case.
 */
const Swipe: FC<{ legacy: string; rebuild: string }> = ({ legacy, rebuild }) => {
  const [split, setSplit] = useState(50)
  return (
    <Card withBorder radius="lg" padding="sm" data-testid="route-swipe">
      <Box pos="relative" style={{ overflow: 'hidden', borderRadius: 'var(--mantine-radius-sm)' }}>
        <Image src={rebuild} alt={m.route__branch()} fit="contain" />
        <Box pos="absolute" inset={0} style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}>
          <Image src={legacy} alt={m.route__legacy()} fit="contain" />
        </Box>
        <Box
          pos="absolute"
          top={0}
          bottom={0}
          w={2}
          style={{
            left: `calc(${split}% - 1px)`,
            background: 'var(--mantine-color-blue-filled)',
            pointerEvents: 'none',
          }}
        />
      </Box>
      <Group justify="space-between" mt="xs">
        <Text size="xs" fw={600}>
          {m.route__legacy()}
        </Text>
        <Text size="xs" fw={600}>
          {m.route__branch()}
        </Text>
      </Group>
      <Slider
        value={split}
        onChange={setSplit}
        label={null}
        mt={4}
        aria-label={m.route__swipe_label()}
      />
      <Text size="xs" c="dimmed" mt="xs">
        {m.route__swipe_hint()}
      </Text>
    </Card>
  )
}

/**
 * One screen, three images.
 *
 * A percentage tells you a screen is wrong and never how, so legacy, the rebuild
 * and the generated difference sit side by side (or on top of each other, split
 * by a slider), with the differing pixel count and the total it was taken over
 * alongside — the number stays auditable. Below, the structural regions the
 * alignment found: sections this rebuild added, dropped or changed, with where
 * each sits on both pages.
 */
export const RouteDetailPage: FC = () => {
  useLocale()
  const { projectId, routeKey } = routeApi.useParams()
  const { branch, state, viewport } = routeApi.useSearch()
  const navigate = useNavigate()
  const [view, setView] = useState<'side' | 'swipe'>('side')

  const project = usePikkuQuery('getProject', { projectId })
  const comparison = usePikkuQuery(
    'routeComparison',
    { projectId, branchKey: branch, routeKey, stateKey: state, viewportKey: viewport },
    { enabled: branch !== '' },
  )

  const data = comparison.data
  const regions = (data?.regions ?? []) as Region[]
  const canSwipe =
    !!data?.baseline &&
    !!data.target &&
    data.baseline.width === data.target.width &&
    data.baseline.height === data.target.height

  return (
    <Box maw={1200} w="100%" mx="auto" data-testid="route-detail">
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
            label: project.data ? asI18n(project.data.project.name) : m.common__loading(),
            render: (label) => (
              <CrumbAnchor
                renderRoot={(props) => (
                  <Link to="/app/projects/$projectId" params={{ projectId }} {...props} />
                )}
              >
                {label}
              </CrumbAnchor>
            ),
          },
          {
            label: m.report__title(),
            render: (label) => (
              <CrumbAnchor
                renderRoot={(props) => (
                  <Link
                    to="/app/projects/$projectId/report"
                    params={{ projectId }}
                    search={branch ? { branch } : {}}
                    data-testid="route-back"
                    {...props}
                  />
                )}
              >
                {label}
              </CrumbAnchor>
            ),
          },
        ]}
        title={asI18n(data?.routeLabel ?? routeKey)}
        aside={data ? <StatusBadge status={data.status} size="md" testId="route-status" /> : null}
        description={
          <Text span ff="monospace" size="sm">
            {asI18n(`${routeKey} · ${state} · ${branch}`)}
          </Text>
        }
      />

      <Group justify="space-between" gap="sm" mb="md">
        {project.data && project.data.viewports.length > 1 ? (
          <Group gap="sm">
            <Text size="sm" c="dimmed">
              {m.route__viewport()}
            </Text>
            <SegmentedControl
              size="sm"
              radius="md"
              value={viewport}
              data-testid="route-viewports"
              onChange={(key) =>
                navigate({ to: '.', search: { branch, state, viewport: key }, replace: true })
              }
              data={project.data.viewports.map((option) => ({
                value: option.key,
                label: asI18n(option.label),
              }))}
            />
          </Group>
        ) : (
          <span />
        )}
        <SegmentedControl
          size="sm"
          radius="md"
          value={view}
          aria-label={m.route__view_label()}
          onChange={(value) => setView(value as 'side' | 'swipe')}
          data={[
            { value: 'side', label: m.route__view_side_by_side() },
            { value: 'swipe', label: m.route__view_swipe(), disabled: !canSwipe },
          ]}
        />
      </Group>

      {comparison.isLoading ? (
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
          <Skeleton height={260} radius="lg" />
          <Skeleton height={260} radius="lg" />
          <Skeleton height={260} radius="lg" />
        </SimpleGrid>
      ) : data ? (
        <Stack gap="md">
          {data.diffRatio != null && data.status !== 'size-mismatch' ? (
            <Card withBorder radius="lg" padding="md" data-testid="route-numbers">
              <Group gap="xl" wrap="wrap">
                <Stack gap={0}>
                  <Text
                    fz={28}
                    fw={650}
                    ff="monospace"
                    c={data.status === 'identical' ? 'teal' : 'red'}
                    data-testid="route-ratio"
                  >
                    {asI18n(percent(data.diffRatio))}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {m.route__numbers({
                      diff: (data.diffPixels ?? 0).toLocaleString(),
                      compared: (data.comparedPixels ?? 0).toLocaleString(),
                    })}
                  </Text>
                </Stack>
              </Group>
            </Card>
          ) : null}

          {view === 'swipe' && canSwipe ? (
            <Swipe legacy={data.baseline!.assetUrl} rebuild={data.target!.assetUrl} />
          ) : (
            <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
              <Panel
                label={m.route__legacy()}
                testId="route-legacy"
                src={data.baseline?.assetUrl}
                empty={m.route__no_baseline()}
              />
              <Panel
                label={m.route__branch()}
                testId="route-target"
                src={data.target?.assetUrl}
                empty={m.route__no_target()}
              />
              <Panel
                label={m.route__diff()}
                testId="route-diff"
                src={data.diff?.assetUrl}
                empty={m.route__no_comparison()}
              />
            </SimpleGrid>
          )}

          {data.diff ? (
            <Card withBorder radius="lg" padding="lg" data-testid="route-regions">
              <Text fw={600}>{m.route__regions_title()}</Text>
              <Text c="dimmed" size="sm" mt={4} mb="sm" maw={720}>
                {m.route__regions_hint()}
              </Text>
              {regions.length === 0 ? (
                <Text size="sm">{m.route__regions_none()}</Text>
              ) : (
                <Stack gap={0}>
                  {regions.map((region, i) => (
                    <Group
                      key={i}
                      py={8}
                      gap="sm"
                      wrap="wrap"
                      data-testid="route-region"
                      data-kind={region.kind}
                      style={{
                        borderTop: i ? '1px solid var(--mantine-color-default-border)' : undefined,
                      }}
                    >
                      <Group gap={8} wrap="nowrap" w={190}>
                        <Box
                          w={10}
                          h={10}
                          style={{
                            borderRadius: 3,
                            flex: 'none',
                            background: `var(--mantine-color-${REGION[region.kind].color}-filled)`,
                          }}
                        />
                        <Text size="sm" fw={500}>
                          {REGION[region.kind].label()}
                        </Text>
                      </Group>
                      {(
                        [
                          [m.route__legacy(), region.baseline],
                          [m.route__branch(), region.target],
                        ] as const
                      ).map(([side, span]) => (
                        <Group key={side} gap={6} wrap="nowrap" miw={200}>
                          <Text size="xs" c="dimmed">
                            {side}
                          </Text>
                          <Text size="sm" ff="monospace" c={span.height ? undefined : 'dimmed'}>
                            {span.height ? m.route__region_rows(span) : m.route__region_absent()}
                          </Text>
                        </Group>
                      ))}
                    </Group>
                  ))}
                </Stack>
              )}
            </Card>
          ) : null}
        </Stack>
      ) : (
        <Card withBorder radius="lg" padding="xl" data-testid="route-empty">
          <Text c="dimmed" size="sm">
            {m.route__no_comparison()}
          </Text>
        </Card>
      )}
    </Box>
  )
}
