import { createFileRoute, Outlet } from '@tanstack/react-router'

/**
 * A layout, not a page: the project's own screens — its routes, its report, one
 * route three-up — hang off this file on the strength of their names, so it
 * draws the Outlet and nothing else. The route list is `app.projects.$projectId.index.tsx`.
 */
export const Route = createFileRoute('/app/projects/$projectId')({
  component: Outlet,
})
