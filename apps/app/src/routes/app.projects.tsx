import { createFileRoute, Outlet } from '@tanstack/react-router'

/**
 * A layout, not a page: `app.projects.$projectId.tsx` nests inside this file on
 * the strength of its name, so this draws the Outlet and nothing else. The list
 * itself lives in `app.projects.index.tsx`.
 */
export const Route = createFileRoute('/app/projects')({
  component: Outlet,
})
