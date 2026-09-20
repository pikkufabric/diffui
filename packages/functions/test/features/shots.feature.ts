import { pikkuFeature } from '#pikku/scenarios'
import { aRebuildIsScoredScenario } from '../scenarios/a-rebuild-is-scored.scenario.js'
import { legacyBaselineLandsScenario } from '../scenarios/legacy-baseline-lands.scenario.js'
import { mayaSeesHerLegacyBaselineScenario } from '../scenarios/maya-sees-her-legacy-baseline.scenario.js'
import { reportSeparatesGapsFromScoresScenario } from '../scenarios/report-separates-gaps-from-scores.scenario.js'
import { mayaReadsTheReportScenario } from '../scenarios/maya-reads-the-report.scenario.js'

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
  ],
})
