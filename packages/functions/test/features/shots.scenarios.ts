import { pikkuFeature } from '#pikku/scenarios'
import { aRebuildIsScoredScenario } from '../scenarios/a-rebuild-is-scored.scenario.js'
import { legacyBaselineLandsScenario } from '../scenarios/legacy-baseline-lands.scenario.js'
import { mayaSeesHerLegacyBaselineScenario } from '../scenarios/maya-sees-her-legacy-baseline.scenario.js'
import { reportSeparatesGapsFromScoresScenario } from '../scenarios/report-separates-gaps-from-scores.scenario.js'
import { mayaReadsTheReportScenario } from '../scenarios/maya-reads-the-report.scenario.js'
import { deletingAProjectTakesItsShotsScenario } from '../scenarios/deleting-a-project-takes-its-shots.scenario.js'
import { deletingAProjectTakesItsComparisonsScenario } from '../scenarios/deleting-a-project-takes-its-comparisons.scenario.js'
import { requestShotUploadIsRefusedFromOutsideTheOrganizationScenario } from '../scenarios/request-shot-upload-is-refused-from-outside-the-organization.scenario.js'
import { registerShotIsRefusedFromOutsideTheOrganizationScenario } from '../scenarios/register-shot-is-refused-from-outside-the-organization.scenario.js'
import { listShotsIsRefusedFromOutsideTheOrganizationScenario } from '../scenarios/list-shots-is-refused-from-outside-the-organization.scenario.js'
import { declareBranchIsRefusedFromOutsideTheOrganizationScenario } from '../scenarios/declare-branch-is-refused-from-outside-the-organization.scenario.js'
import { projectReportIsRefusedFromOutsideTheOrganizationScenario } from '../scenarios/project-report-is-refused-from-outside-the-organization.scenario.js'
import { listBranchesIsRefusedFromOutsideTheOrganizationScenario } from '../scenarios/list-branches-is-refused-from-outside-the-organization.scenario.js'
import { routeComparisonIsRefusedFromOutsideTheOrganizationScenario } from '../scenarios/route-comparison-is-refused-from-outside-the-organization.scenario.js'

export const shotsFeature = pikkuFeature({
  name: 'shots',
  description: 'Screenshots land directly at storage and are scored against the legacy baseline',
  tags: ['shots'],
  scenarios: [
    legacyBaselineLandsScenario,
    mayaSeesHerLegacyBaselineScenario,
    aRebuildIsScoredScenario,
    reportSeparatesGapsFromScoresScenario,
    mayaReadsTheReportScenario,
    deletingAProjectTakesItsShotsScenario,
    deletingAProjectTakesItsComparisonsScenario,
    requestShotUploadIsRefusedFromOutsideTheOrganizationScenario,
    registerShotIsRefusedFromOutsideTheOrganizationScenario,
    listShotsIsRefusedFromOutsideTheOrganizationScenario,
    declareBranchIsRefusedFromOutsideTheOrganizationScenario,
    projectReportIsRefusedFromOutsideTheOrganizationScenario,
    listBranchesIsRefusedFromOutsideTheOrganizationScenario,
    routeComparisonIsRefusedFromOutsideTheOrganizationScenario,
  ],
})
