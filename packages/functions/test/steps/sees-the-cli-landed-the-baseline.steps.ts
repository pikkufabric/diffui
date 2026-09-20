import { z } from 'zod'
import { pikkuScenarioStep } from '#pikku/scenarios'
import { rpcWithDevKey } from '../lib/cli.js'

export const SeesTheCliLandedTheBaselineInput = z.object({
  projectId: z.string(),
})

export const SeesTheCliLandedTheBaselineOutput = z.object({
  baselines: z.number(),
  scored: z.number(),
})

/**
 * What the CLI's push left behind, read back from the server.
 *
 * The CLI prints a verdict, and a tool that prints `different 33%` while the
 * server stored nothing would still pass a stdout assertion. This asks the
 * server directly: is there a pinned legacy baseline, and was the rebuild
 * scored against it.
 */
export const seesTheCliLandedTheBaseline = pikkuScenarioStep({
  name: 'seesTheCliLandedTheBaseline',
  description: 'reads the shots and score back from the server after the CLI pushed them',
  template: 'the CLI push left a baseline and a score',
  input: SeesTheCliLandedTheBaselineInput,
  output: SeesTheCliLandedTheBaselineOutput,
  default: async (_services, { projectId }, { scenarioStep }) => {
    const apiUrl = scenarioStep?.env?.apiUrl
    if (!apiUrl) throw new Error('seesTheCliLandedTheBaseline needs the environment apiUrl.')

    const listed = await rpcWithDevKey<{
      shots: Array<{ side: 'legacy' | 'new'; isBaseline: boolean }>
    }>(apiUrl, 'listShots', { projectId })
    const baselines = listed.shots.filter(
      (shot) => shot.side === 'legacy' && shot.isBaseline,
    ).length
    if (baselines !== 1) {
      throw new Error(`The CLI left ${baselines} pinned baselines; expected exactly one.`)
    }

    const report = await rpcWithDevKey<{ summary: { scored: number } }>(apiUrl, 'projectReport', {
      projectId,
      branchKey: 'rebuild-1',
    })
    if (report.summary.scored !== 1) {
      throw new Error(`The CLI's rebuild was not scored: ${JSON.stringify(report.summary)}.`)
    }

    return { baselines, scored: report.summary.scored }
  },
})
