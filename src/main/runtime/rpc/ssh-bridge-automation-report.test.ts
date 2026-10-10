import './unused-default-rpc-methods.test-fixture'
import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from '../orca-runtime'
import { RpcDispatcher } from './dispatcher'
import { AUTOMATION_METHODS } from './methods/automations'
import type { AutomationRun } from '../../../shared/automations-types'
import type { ExecutionHostId } from '../../../shared/execution-host'

function runOn(reportHostId: ExecutionHostId | undefined): AutomationRun {
  return {
    id: 'run-1',
    automationId: 'auto-1',
    title: 'Daily check',
    scheduledFor: 1,
    reportHostId,
    reportToken: 'token-1',
    status: 'completed',
    trigger: 'scheduled',
    workspaceId: null,
    sessionKind: 'terminal',
    chatSessionId: null,
    terminalSessionId: null,
    terminalPaneKey: null,
    terminalPtyId: null,
    outputSnapshot: null,
    precheckResult: null,
    usage: null,
    error: null,
    startedAt: 1,
    dispatchedAt: 1,
    createdAt: 1
  }
}

describe('SSH automation result authorization', () => {
  it.each([
    { host: 'ssh:box-1' as const, token: 'token-1', allowed: true },
    { host: 'ssh:box-2' as const, token: 'token-1', allowed: false },
    { host: 'local' as const, token: 'token-1', allowed: false },
    { host: undefined, token: 'token-1', allowed: false },
    { host: 'ssh:box-1' as const, token: 'wrong-run', allowed: false }
  ])('binds the report to its captured host and token: %j', async ({ host, token, allowed }) => {
    const runtime = new OrcaRuntimeService()
    const run = runOn(host)
    vi.spyOn(runtime, 'listAutomationRuns').mockReturnValue([run])
    const report = vi.spyOn(runtime, 'reportAutomationRunResult').mockResolvedValue(run)
    const response = await new RpcDispatcher({ runtime, methods: AUTOMATION_METHODS }).dispatch(
      {
        id: 'req-report',
        authToken: 'unused',
        method: 'automation.reportRun',
        params: { runId: run.id, token, status: 'failed', message: 'Login expired' }
      },
      { callerScope: { kind: 'ssh-bridge', targetId: 'box-1', remoteCliControl: false } }
    )
    expect(response.ok).toBe(allowed)
    if (allowed) {
      expect(report).toHaveBeenCalledOnce()
    } else {
      expect(response).toMatchObject({ ok: false, error: { code: 'forbidden' } })
      expect(report).not.toHaveBeenCalled()
    }
  })
})
