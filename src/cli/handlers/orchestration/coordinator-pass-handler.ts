import type { CommandHandler } from '../../dispatch'
import { printResult } from '../../format'
import { getOptionalPositiveIntegerFlag, getRequiredStringFlag } from '../../flags'
import { RuntimeClientError } from '../../runtime-client'
import { ORCHESTRATION_COORDINATOR_DELIVERY_CAPABILITY } from '../../../shared/orchestration-coordinator-delivery'
import { callOrchestrationMutation } from './mutation-request'
import { resolveCoordinatorTerminalHandle } from './terminal-identity'

export const ORCHESTRATION_COORDINATOR_PASS_HANDLER: Record<string, CommandHandler> = {
  'orchestration request-pass': async ({ flags, client, cwd, json }) => {
    const run = getRequiredStringFlag(flags, 'run')
    const consumerGeneration = getOptionalPositiveIntegerFlag(flags, 'consumer-generation')
    if (!consumerGeneration) {
      throw new RuntimeClientError('invalid_argument', 'Missing --consumer-generation')
    }
    const result = await callOrchestrationMutation(
      client,
      flags,
      'orchestration.send',
      {
        from: await resolveCoordinatorTerminalHandle(flags, cwd, client),
        to: `run:${run}`,
        run,
        type: 'status',
        subject: 'Request one bounded reconciliation pass',
        body: 'Reconcile the current actionable batch and unit snapshot in this owning hub; preserve authority, pause and expiry. This request grants no new authority.',
        coordinatorPass: {
          handle: getRequiredStringFlag(flags, 'owner'),
          consumerGeneration,
          processIncarnation: getRequiredStringFlag(flags, 'process-incarnation')
        }
      },
      { orchestrationCapability: ORCHESTRATION_COORDINATOR_DELIVERY_CAPABILITY }
    )
    printResult(result, json, () => 'Reconciliation pass queued; turn start is not yet observed.')
  }
}
