import type { AutomationSemanticEvaluationConfig } from '../../shared/automations-types'
import {
  AUTOMATION_EXTRA_AGENT_ARGS_RUNTIME_CAPABILITY,
  AUTOMATION_SEMANTIC_EVALUATION_RUNTIME_CAPABILITY,
  AUTOMATION_SEMANTIC_EVALUATION_UPDATE_REQUIRED_MESSAGE
} from '../../shared/protocol-version'
import {
  EXTRA_AGENT_ARGS_HOST_UPDATE_REQUIRED,
  hasExtraAgentArgs
} from '../../shared/automation-extra-agent-args'
import type { RuntimeStatus } from '../../shared/runtime-types'
import { RuntimeClientError, type RuntimeClient } from '../runtime-client'

// Why: an older runtime strips the field and would run the automation without it.
export async function assertExtraAgentArgsSupported(
  client: RuntimeClient,
  extraAgentArgs: string | undefined
): Promise<void> {
  if (!hasExtraAgentArgs(extraAgentArgs)) {
    return
  }
  const status = await client.call<RuntimeStatus>('status.get')
  if (!status.result.capabilities?.includes(AUTOMATION_EXTRA_AGENT_ARGS_RUNTIME_CAPABILITY)) {
    throw new RuntimeClientError('incompatible_runtime', EXTRA_AGENT_ARGS_HOST_UPDATE_REQUIRED)
  }
}

// Why: an older runtime strips this optional field, which would make a configured
// evaluation appear to succeed while the schedule actually runs without it.
export async function assertSemanticEvaluationSupported(
  client: RuntimeClient,
  semanticEvaluation: AutomationSemanticEvaluationConfig | null | undefined,
  required = semanticEvaluation !== undefined
): Promise<void> {
  if (!required) {
    return
  }
  const status = await client.call<RuntimeStatus>('status.get')
  if (!status.result.capabilities?.includes(AUTOMATION_SEMANTIC_EVALUATION_RUNTIME_CAPABILITY)) {
    throw new RuntimeClientError(
      'incompatible_runtime',
      AUTOMATION_SEMANTIC_EVALUATION_UPDATE_REQUIRED_MESSAGE
    )
  }
}
