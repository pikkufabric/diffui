import { createFileRoute } from '@tanstack/react-router'
import { RouteDetailPage } from '@/pages/RouteDetailPage'

export const Route = createFileRoute('/app/projects/$projectId/routes/$routeKey')({
  validateSearch: (search: Record<string, unknown>) => ({
    branch: typeof search.branch === 'string' ? search.branch : '',
    state: typeof search.state === 'string' ? search.state : 'default',
    viewport: typeof search.viewport === 'string' ? search.viewport : 'desktop',
  }),
  component: RouteDetailPage,
})
