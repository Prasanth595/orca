import {
  AUTOMATION_EXTRA_AGENT_ARGS_RUNTIME_CAPABILITY,
  AUTOMATION_NOTIFICATION_POLICY_RUNTIME_CAPABILITY,
  AUTOMATION_NOTIFICATION_POLICY_UPDATE_REQUIRED_MESSAGE
} from '../../shared/automation-runtime-capabilities'
import {
  EXTRA_AGENT_ARGS_HOST_UPDATE_REQUIRED,
  hasExtraAgentArgs
} from '../../shared/automation-extra-agent-args'
import type { RuntimeStatus } from '../../shared/runtime-types'
import { RuntimeClientError, type RuntimeClient } from '../runtime-client'

export async function assertAutomationMutationCapabilities(
  client: RuntimeClient,
  input: { extraAgentArgs?: string; notifyOnFailure?: boolean }
): Promise<void> {
  const requirements = [
    ...(hasExtraAgentArgs(input.extraAgentArgs)
      ? [
          {
            capability: AUTOMATION_EXTRA_AGENT_ARGS_RUNTIME_CAPABILITY,
            message: EXTRA_AGENT_ARGS_HOST_UPDATE_REQUIRED
          }
        ]
      : []),
    ...(input.notifyOnFailure !== undefined
      ? [
          {
            capability: AUTOMATION_NOTIFICATION_POLICY_RUNTIME_CAPABILITY,
            message: AUTOMATION_NOTIFICATION_POLICY_UPDATE_REQUIRED_MESSAGE
          }
        ]
      : [])
  ]
  if (requirements.length === 0) {
    return
  }
  const status = await client.call<RuntimeStatus>('status.get')
  for (const { capability, message } of requirements) {
    if (!status.result.capabilities?.includes(capability)) {
      throw new RuntimeClientError('incompatible_runtime', message)
    }
  }
}
