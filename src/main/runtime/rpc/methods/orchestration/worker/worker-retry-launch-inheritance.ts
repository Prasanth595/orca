import { z } from 'zod'
import type { WorkerStartInput } from './worker-start-schema'

const RecordedLaunchSelection = z.object({
  launch: z.object({
    requested: z.object({
      agent: z.string().nullable(),
      model: z.string().nullable(),
      effort: z.string().nullable()
    })
  })
})

function readRecordedLaunchSelection(startOptions: string) {
  try {
    const parsed = RecordedLaunchSelection.safeParse(JSON.parse(startOptions))
    return parsed.success ? parsed.data.launch.requested : null
  } catch {
    return null
  }
}

/**
 * A local `--retry-of` that names neither `--agent` nor `--terminal` relaunches the agent the
 * retried Dispatch recorded. Any explicit flag wins; placement is still never inherited.
 */
export function inheritRetryLaunchSelection<T extends WorkerStartInput>(
  db: { getWorkerDispatch(id: string): { start_options: string } | null | undefined },
  params: T
): T {
  // Why: an --on retry's launch selection lives on the remote host, not in this Dispatch row.
  if (!params.retryOf || params.on || params.agent || params.terminal) {
    return params
  }
  const prior = db.getWorkerDispatch(params.retryOf)
  const recorded = prior ? readRecordedLaunchSelection(prior.start_options) : null
  if (!recorded?.agent) {
    return params
  }
  // Effort is scoped to its model, so an explicit --model drops the recorded effort.
  const model = params.model ?? recorded.model ?? undefined
  const effort = params.effort ?? (params.model ? undefined : (recorded.effort ?? undefined))
  return { ...params, agent: recorded.agent, model, effort }
}
