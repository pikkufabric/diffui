import { createFileRoute } from '@tanstack/react-router'
import { ReportPage } from '@/pages/ReportPage'

export const Route = createFileRoute('/app/projects/$projectId/report')({
  /* The rebuild being read lives in the URL, not in component state, so a link
     from the home screen opens the right one and "back to the report" from a
     route returns to it rather than to whichever branch sorts first. */
  validateSearch: (search: Record<string, unknown>): { branch?: string } =>
    typeof search.branch === 'string' && search.branch !== '' ? { branch: search.branch } : {},
  component: ReportPage,
})
