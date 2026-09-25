import { useState } from 'react'
import type { FC } from 'react'
import type { I18nString } from '@pikku/react'
import { useForm } from '@tanstack/react-form'
import { useQueryClient } from '@tanstack/react-query'
import {
  Anchor,
  Box,
  Button,
  Card,
  Group,
  ScrollArea,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
} from '@pikku/mantine/core'
import { Link } from '@tanstack/react-router'
import { usePikkuMutation, usePikkuQuery } from '@project/functions-sdk/pikku/api.gen'
import { m, asI18n } from '@/i18n/messages'
import { useLocale } from '@/i18n/config'
import { PageHeader } from '@/components/PageHeader'

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

  const [query, setQuery] = useState('')
  const all = projects.data?.projects ?? []
  const needle = query.trim().toLowerCase()
  const rows = needle
    ? all.filter(
        (project) =>
          project.name.toLowerCase().includes(needle) ||
          project.slug.toLowerCase().includes(needle),
      )
    : all

  return (
    <Box maw={1080} w="100%" mx="auto">
      <PageHeader title={m.projects__title()} description={m.projects__description()} />

      <Card withBorder radius="lg" padding="lg" mb="lg">
        <Text fw={600} size="sm" mb="sm">
          {m.projects__new()}
        </Text>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            form.handleSubmit()
          }}
        >
          <Stack gap="sm">
            <Group align="flex-start" gap="sm" wrap="wrap">
              <form.Field name="name" validators={{ onChange: ({ value }) => required(value) }}>
                {(field) => (
                  <TextInput
                    style={{ flex: '2 1 220px' }}
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
                    style={{ flex: '1 1 180px' }}
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

              <Button
                type="submit"
                loading={create.isPending}
                data-testid="project-create"
                mt={25}
                style={{ flex: 'none' }}
              >
                {m.common__create()}
              </Button>
            </Group>

            {/* Inline beside the control that failed, never a toast — a toast for
                a failed create is gone before the person has read it. */}
            {create.isError ? (
              <Text c="red" size="sm" data-testid="project-create-error">
                {m.projects__create_failed()}
              </Text>
            ) : null}
          </Stack>
        </form>
      </Card>

      {projects.isLoading ? (
        <Stack gap="sm">
          <Skeleton height={44} radius="md" />
          <Skeleton height={44} radius="md" />
        </Stack>
      ) : all.length === 0 ? (
        <Card withBorder radius="lg" padding="xl" data-testid="projects-empty">
          <Stack gap={4} align="center">
            <Text fw={600}>{m.projects__empty_title()}</Text>
            <Text c="dimmed" size="sm">
              {m.projects__empty_hint()}
            </Text>
          </Stack>
        </Card>
      ) : (
        <Card withBorder radius="lg" padding={0}>
          <Group justify="space-between" p="md" gap="sm">
            <TextInput
              placeholder={m.projects__search()}
              aria-label={m.projects__search()}
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              data-testid="projects-search"
              style={{ flex: '1 1 260px', maxWidth: 360 }}
            />
            <Text size="xs" c="dimmed">
              {m.projects__count({ count: rows.length })}
            </Text>
          </Group>
          {rows.length === 0 ? (
            <Text c="dimmed" size="sm" ta="center" pb="lg">
              {m.projects__search_empty()}
            </Text>
          ) : (
            <ScrollArea type="auto">
              <Table highlightOnHover verticalSpacing="sm" data-testid="projects-list">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th pl="md">{m.projects__col_name()}</Table.Th>
                    <Table.Th visibleFrom="sm">{m.projects__field_slug()}</Table.Th>
                    <Table.Th visibleFrom="sm">{m.projects__col_sides()}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.map((project) => (
                    <Table.Tr
                      key={project.projectId}
                      data-testid="project-card"
                      data-slug={project.slug}
                    >
                      <Table.Td pl="md">
                        {/* `renderRoot` rather than `component={Link}`: passing Link as
                            `component` erases TanStack's route generics, so `params`
                            stops type-checking against the route it belongs to. */}
                        <Anchor
                          fw={600}
                          size="sm"
                          c="var(--mantine-color-text)"
                          underline="hover"
                          data-testid="project-open"
                          style={{ overflowWrap: 'anywhere' }}
                          renderRoot={(props) => (
                            <Link
                              to="/app/projects/$projectId"
                              params={{ projectId: project.projectId }}
                              {...props}
                            />
                          )}
                        >
                          <span data-testid="project-card-name">{asI18n(project.name)}</span>
                        </Anchor>
                        <Text size="xs" c="dimmed" ff="monospace" hiddenFrom="sm">
                          {asI18n(project.slug)}
                        </Text>
                      </Table.Td>
                      <Table.Td visibleFrom="sm">
                        <Text size="xs" c="dimmed" ff="monospace">
                          {asI18n(project.slug)}
                        </Text>
                      </Table.Td>
                      <Table.Td visibleFrom="sm">
                        <Text size="xs" c="dimmed">
                          {asI18n(`${project.baselineLabel} → ${project.targetLabel}`)}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          )}
        </Card>
      )}
    </Box>
  )
}
