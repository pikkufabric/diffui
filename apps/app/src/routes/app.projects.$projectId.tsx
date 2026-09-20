import { createFileRoute } from '@tanstack/react-router'
import { ProjectRoutesPage } from '@/pages/ProjectRoutesPage'

export const Route = createFileRoute('/app/projects/$projectId')({
  component: ProjectRoutesPage,
})
