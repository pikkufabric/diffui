import { createFileRoute } from '@tanstack/react-router'
import { ProjectsPage } from '@/pages/ProjectsPage'

export const Route = createFileRoute('/app/projects/')({
  component: ProjectsPage,
})
