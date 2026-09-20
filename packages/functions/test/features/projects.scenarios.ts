import { pikkuFeature } from '#pikku/scenarios'
import { routesRoundTripByKeyScenario } from '../scenarios/routes-round-trip-by-key.scenario.js'
import { deletingAProjectTakesItsRoutesScenario } from '../scenarios/deleting-a-project-takes-its-routes.scenario.js'
import { mayaDeclaresARouteScenario } from '../scenarios/maya-declares-a-route.scenario.js'
import { rafiCannotReachAnotherOrgsProjectScenario } from '../scenarios/rafi-cannot-reach-another-orgs-project.scenario.js'
import { getProjectIsRefusedFromOutsideTheOrganizationScenario } from '../scenarios/get-project-is-refused-from-outside-the-organization.scenario.js'
import { createProjectIsRefusedFromOutsideTheOrganizationScenario } from '../scenarios/create-project-is-refused-from-outside-the-organization.scenario.js'
import { listProjectsIsRefusedFromOutsideTheOrganizationScenario } from '../scenarios/list-projects-is-refused-from-outside-the-organization.scenario.js'
import { declareRoutesIsRefusedFromOutsideTheOrganizationScenario } from '../scenarios/declare-routes-is-refused-from-outside-the-organization.scenario.js'
import { listRoutesIsRefusedFromOutsideTheOrganizationScenario } from '../scenarios/list-routes-is-refused-from-outside-the-organization.scenario.js'
import { deleteProjectIsRefusedFromOutsideTheOrganizationScenario } from '../scenarios/delete-project-is-refused-from-outside-the-organization.scenario.js'

export const projectsFeature = pikkuFeature({
  name: 'projects',
  description: 'A project holds the screens it tracks, and only its own organisation can reach it',
  tags: ['projects'],
  scenarios: [
    routesRoundTripByKeyScenario,
    deletingAProjectTakesItsRoutesScenario,
    mayaDeclaresARouteScenario,
    rafiCannotReachAnotherOrgsProjectScenario,
    getProjectIsRefusedFromOutsideTheOrganizationScenario,
    createProjectIsRefusedFromOutsideTheOrganizationScenario,
    listProjectsIsRefusedFromOutsideTheOrganizationScenario,
    declareRoutesIsRefusedFromOutsideTheOrganizationScenario,
    listRoutesIsRefusedFromOutsideTheOrganizationScenario,
    deleteProjectIsRefusedFromOutsideTheOrganizationScenario,
  ],
})
