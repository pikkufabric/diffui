import type { FC } from 'react'
import type { I18nString } from '@pikku/react'
import {
  Badge,
  Box,
  Button,
  Card,
  Group,
  Image,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  Title,
} from '@pikku/mantine/core'
import { getRouteApi, Link } from '@tanstack/react-router'
import { usePikkuQuery } from '@project/functions-sdk/pikku/api.gen'
import { m, asI18n } from '@/i18n/messages'
import { useLocale } from '@/i18n/config'

const routeApi = getRouteApi('/app/projects/$projectId/routes/$routeKey')

const Panel: FC<{
  label: I18nString
  src?: string | null
  testId: string
  alt: I18nString
  empty: I18nString
}> = ({ label, src, testId, alt, empty }) => (
  <Card withBorder radius="lg" padding="sm">
    <Stack gap="xs">
      <Text fw={600} size="sm">
        {label}
      </Text>
      {src ? (
        <Image src={src} alt={alt} fit="contain" mah={320} radius="sm" data-testid={testId} />
      ) : (
        <Text c="dimmed" size="sm" data-testid={`${testId}-empty`}>
          {empty}
        </Text>
      )}
    </Stack>
  </Card>
)

/**
 * One route, three images.
 *
 * A percentage tells you a screen is wrong and never how, so legacy, the branch
 * and the generated difference sit side by side, with the differing pixel count
 * and the total it was taken over underneath — the number stays auditable.
 */
export const RouteDetailPage: FC = () => {
  useLocale()
  const { projectId, routeKey } = routeApi.useParams()
  const { branch, state, viewport } = routeApi.useSearch()

  const comparison = usePikkuQuery(
    'routeComparison',
    { projectId, branchKey: branch, routeKey, stateKey: state, viewportKey: viewport },
    { enabled: branch !== '' },
  )

  const data = comparison.data

  return (
    <Box maw={1080} w="100%" mx="auto" data-testid="route-detail">
      <Button
        variant="subtle"
        size="compact-sm"
        mb="sm"
        data-testid="route-back"
        renderRoot={(props) => (
          <Link to="/app/projects/$projectId/report" params={{ projectId }} {...props} />
        )}
      >
        {m.route__back()}
      </Button>

      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Title order={1} fz={24} fw={650} style={{ letterSpacing: '-0.025em' }}>
          {asI18n(routeKey)}
        </Title>
        {data ? (
          <Badge variant="light" data-testid="route-status" data-status={data.status}>
            {asI18n(data.status)}
          </Badge>
        ) : null}
      </Group>
      <Text c="dimmed" size="sm" mt={6} mb="lg" ff="monospace">
        {asI18n(`${state} · ${viewport}`)}
      </Text>

      {comparison.isLoading ? (
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
          <Skeleton height={220} radius="lg" />
          <Skeleton height={220} radius="lg" />
          <Skeleton height={220} radius="lg" />
        </SimpleGrid>
      ) : data ? (
        <>
          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
            <Panel
              label={m.route__legacy()}
              alt={m.route__legacy()}
              testId="route-legacy"
              src={data.baseline?.assetUrl}
              empty={m.route__no_baseline()}
            />
            <Panel
              label={m.route__branch()}
              alt={m.route__branch()}
              testId="route-target"
              src={data.target?.assetUrl}
              empty={m.route__no_target()}
            />
            <Panel
              label={m.route__diff()}
              alt={m.route__diff()}
              testId="route-diff"
              src={data.diff?.assetUrl}
              empty={m.route__no_comparison()}
            />
          </SimpleGrid>

          <Card withBorder radius="lg" padding="lg" mt="md">
            <Group gap="lg" data-testid="route-numbers">
              <Text size="sm" ff="monospace">
                {asI18n(
                  `${data.diffPixels ?? 0} ${m.route__diff_pixels()} ${data.comparedPixels ?? 0} ${m.route__compared_pixels()}`,
                )}
              </Text>
              <Text size="sm" fw={600} ff="monospace" data-testid="route-ratio">
                {asI18n(data.diffRatio == null ? '—' : `${(data.diffRatio * 100).toFixed(2)}%`)}
              </Text>
            </Group>
          </Card>
        </>
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
