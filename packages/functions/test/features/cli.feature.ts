import { pikkuFeature } from '#pikku/scenarios'
import { theCliPushesScreenshotsScenario } from '../scenarios/the-cli-pushes-screenshots.scenario.js'

export const cliFeature = pikkuFeature({
  name: 'cli',
  description: 'The diffui command pushes captures the way a consuming repo does',
  tags: ['cli'],
  scenarios: [theCliPushesScreenshotsScenario],
})
