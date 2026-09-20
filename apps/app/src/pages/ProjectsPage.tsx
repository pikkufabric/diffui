import type { FC } from 'react'
import type { I18nString } from '@pikku/react'
import { useForm } from '@tanstack/react-form'
import { useQueryClient } from '@tanstack/react-query'
import {
  Badge,
  Box,
  Button,
  Card,
  Group,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Title,
} from '@pikku/mantine/core'
import { Link } from '@tanstack/react-router'
import { usePikkuMutation, usePikkuQuery } from '@project/functions-sdk/pikku/api.gen'
import { m, asI18n } from '@/i18n/messages'
import { useLocale } from '@/i18n/config'

const SLUG = /^[a-z0-9][a-z0-9-]*$/

const required = (value: string): I18nString | undefined =>
  value.trim() ? undefined : m.validation__required()

const slugValid = (value: string): I18nString | undefined =>
  required(value) ?? (SLUG.test(value) ? undefined : m.projects__field_slug_invalid())

/**
 * The projects this person's organisation has, and the form that makes one.
 *
 * There is no "create your organisation" step before this: the first project
 * creates the organisation that owns it, so a signed-in person can do the thing
 * the app is for immediately.
 */
export const ProjectsPage: FC = () => {
  useLocale()
  const queryClient = useQueryClient()

  const projects = usePikkuQuery('listProjects', {})

  const create = usePikkuMutation('createProject', {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['listProjects'] })
      form.reset()
    },
  })

  const form = useForm({
    defaultValues: { name: '', slug: '' },
    onSubmit: ({ value }) => create.mutate({ name: value.name.trim(), slug: value.slug.trim() }),
  })

  const rows = projects.data?.projects ?? []

  return (
    <Box maw={880} w="100%" mx="auto">
      <Title order={1} fz={24} fw={650} style={{ letterSpacing: '-0.025em' }}>
        {m.projects__title()}
      </Title>
      <Text c="dimmed" size="sm" mt={6} mb="lg" style={{ lineHeight: 1.55 }}>
        {m.projects__description()}
      </Text>

      <Card withBorder radius="lg" shadow="sm" padding="lg" mb="lg">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            form.handleSubmit()
          }}
        >
          <Stack gap="sm">
            <Group align="flex-start" grow>
              <form.Field name="name" validators={{ onChange: ({ value }) => required(value) }}>
                {(field) => (
                  <TextInput
                    label={m.projects__field_name()}
                    placeholder={m.projects__field_name_placeholder()}
                    data-testid="project-name"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.currentTarget.value)}
                    onBlur={field.handleBlur}
                    error={field.state.meta.isTouched ? field.state.meta.errors[0] : undefined}
                  />
                )}
              </form.Field>

              <form.Field name="slug" validators={{ onChange: ({ value }) => slugValid(value) }}>
                {(field) => (
                  <TextInput
                    label={m.projects__field_slug()}
                    placeholder={m.projects__field_slug_placeholder()}
                    data-testid="project-slug"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.currentTarget.value)}
                    onBlur={field.handleBlur}
                    error={field.state.meta.isTouched ? field.state.meta.errors[0] : undefined}
                  />
                )}
              </form.Field>
            </Group>

            {/* Inline beside the control that failed, never a toast — a toast for
                a failed create is gone before the person has read it. */}
            {create.isError ? (
              <Text c="red" size="sm" data-testid="project-create-error">
                {m.projects__create_failed()}
              </Text>
            ) : null}

            <Group justify="flex-end">
              <Button type="submit" loading={create.isPending} data-testid="project-create">
                {m.projects__new()}
              </Button>
            </Group>
          </Stack>
        </form>
      </Card>

      {projects.isLoading ? (
        <Stack gap="sm">
          <Skeleton height={72} radius="lg" />
          <Skeleton height={72} radius="lg" />
        </Stack>
      ) : rows.length === 0 ? (
        <Card withBorder radius="lg" padding="xl" data-testid="projects-empty">
          <Stack gap={4} align="center">
            <Text fw={600}>{m.projects__empty_title()}</Text>
            <Text c="dimmed" size="sm">
              {m.projects__empty_hint()}
            </Text>
          </Stack>
        </Card>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md" data-testid="projects-list">
          {rows.map((project) => (
            <Card
              key={project.projectId}
              withBorder
              radius="lg"
              padding="lg"
              data-testid="project-card"
              data-slug={project.slug}
            >
              <Stack gap="xs">
                <Group justify="space-between" wrap="nowrap">
                  <Text fw={600} data-testid="project-card-name">
                    {asI18n(project.name)}
                  </Text>
                  <Badge variant="light">{asI18n(project.slug)}</Badge>
                </Group>
                <Group gap={6}>
                  <Badge size="sm" variant="default">
                    {asI18n(project.baselineLabel)}
                  </Badge>
                  <Badge size="sm" variant="default">
                    {asI18n(project.targetLabel)}
                  </Badge>
                </Group>
                {/* `renderRoot` rather than `component={Link}`: passing Link as
                    `component` erases TanStack's route generics, so `params`
                    stops type-checking against the route it belongs to and a
                    typo in a param name becomes a runtime 404. This keeps both
                    type systems intact. */}
                <Button
                  variant="light"
                  mt="xs"
                  data-testid="project-open"
                  renderRoot={(props) => (
                    <Link
                      to="/app/projects/$projectId"
                      params={{ projectId: project.projectId }}
                      {...props}
                    />
                  )}
                >
                  {m.projects__open()}
                </Button>
              </Stack>
            </Card>
          ))}
        </SimpleGrid>
      )}
    </Box>
  )
}
