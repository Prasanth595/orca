import type { CommandHandler } from '../dispatch'
import { getRequiredStringFlag } from '../flags'
import { RuntimeClientError } from '../runtime-client'
import type { RuntimeStatus } from '../../shared/runtime-types'
import { AUTOMATION_RUN_REPORT_RUNTIME_CAPABILITY } from '../../shared/automation-runtime-capabilities'
import type { AutomationRun } from '../../shared/automations-types'
import { formatAutomationRun, printResult } from '../format'

export const reportAutomationRun: CommandHandler = async ({ flags, client, json }) => {
  const suppliedStatus = getRequiredStringFlag(flags, 'status')
  if (suppliedStatus !== 'failed' && suppliedStatus !== 'needs-attention') {
    throw new RuntimeClientError(
      'invalid_argument',
      'Use --status failed or --status needs-attention.'
    )
  }
  const input = {
    runId: getRequiredStringFlag(flags, 'run-id'),
    token: getRequiredStringFlag(flags, 'run-token'),
    status: suppliedStatus === 'failed' ? ('failed' as const) : ('needs_attention' as const),
    message: getRequiredStringFlag(flags, 'message')
  }
  const host = await client.call<RuntimeStatus>('status.get')
  if (!host.result.capabilities?.includes(AUTOMATION_RUN_REPORT_RUNTIME_CAPABILITY)) {
    throw new RuntimeClientError(
      'incompatible_runtime',
      'Reporting automation results requires a newer Orca server. Update the execution host and try again.'
    )
  }
  const result = await client.call<{ run: AutomationRun }>('automation.reportRun', input)
  printResult(result, json, formatAutomationRun)
}
