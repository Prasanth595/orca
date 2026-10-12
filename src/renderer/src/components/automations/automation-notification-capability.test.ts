import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AUTOMATION_CREATE_IDEMPOTENCY_RUNTIME_CAPABILITY,
  AUTOMATION_NOTIFICATION_POLICY_RUNTIME_CAPABILITY,
  AUTOMATION_OWNER_FENCING_RUNTIME_CAPABILITY
} from '../../../../shared/automation-runtime-capabilities'
import type { AutomationCreateInput } from '../../../../shared/automations-types'
import { makeAutomation } from './automations-page-fixtures'

const callRuntimeRpc = vi.fn()
const getRuntimeEnvironmentStatus = vi.fn()
vi.mock('@/runtime/runtime-rpc-client', () => ({
  callRuntimeRpc: (...args: unknown[]) => callRuntimeRpc(...args),
  getRuntimeEnvironmentStatus: (...args: unknown[]) => getRuntimeEnvironmentStatus(...args),
  hasRuntimeRpcErrorCode: () => false
}))

const RUNTIME = { kind: 'runtime', environmentId: 'env-1', pairingRevision: 4 } as const
const OWNER = { authority: RUNTIME, selector: { kind: 'self' } } as const
const LEGACY_CAPABILITIES = [
  AUTOMATION_OWNER_FENCING_RUNTIME_CAPABILITY,
  AUTOMATION_CREATE_IDEMPOTENCY_RUNTIME_CAPABILITY
]
const INPUT: AutomationCreateInput = {
  creationKey: 'move-1',
  name: 'Review',
  prompt: 'go',
  agentId: 'claude',
  projectId: 'repo-1',
  workspaceMode: 'new_per_run',
  timezone: 'UTC',
  rrule: 'FREQ=DAILY',
  dtstart: 1
}

beforeEach(async () => {
  callRuntimeRpc.mockReset()
  getRuntimeEnvironmentStatus.mockReset()
  ;(await import('./automation-scoped-list-client')).resetAutomationCapabilityProbes()
})

describe('per-automation notification compatibility', () => {
  it.each([true, false])(
    'refuses %s on an older host before creating or updating',
    async (notifyOnFailure) => {
      const { createAutomationForDestination, updateAutomationForOwner } =
        await import('./automation-scoped-list-client')
      getRuntimeEnvironmentStatus.mockResolvedValue({ capabilities: LEGACY_CAPABILITIES })
      await expect(
        createAutomationForDestination(
          RUNTIME,
          { ...INPUT, notifyOnFailure },
          { selector: { kind: 'self' } }
        )
      ).rejects.toThrow('Configuring automation alerts requires a newer Orca server')
      await expect(updateAutomationForOwner(OWNER, 'a1', { notifyOnFailure })).rejects.toThrow(
        'Configuring automation alerts requires a newer Orca server'
      )
      expect(callRuntimeRpc).not.toHaveBeenCalled()
    }
  )

  it('preserves legacy edits when the notification setting is untouched', async () => {
    const { updateAutomationForOwner } = await import('./automation-scoped-list-client')
    getRuntimeEnvironmentStatus.mockResolvedValue({ capabilities: LEGACY_CAPABILITIES })
    callRuntimeRpc.mockResolvedValue({ automation: { id: 'a1' } })
    await updateAutomationForOwner(OWNER, 'a1', { name: 'Renamed' })
    expect(callRuntimeRpc).toHaveBeenCalledOnce()
  })

  it.each([true, false])(
    'preserves %s through a remote create and update',
    async (notifyOnFailure) => {
      const { createAutomationForDestination, updateAutomationForOwner } =
        await import('./automation-scoped-list-client')
      getRuntimeEnvironmentStatus.mockResolvedValue({
        capabilities: [...LEGACY_CAPABILITIES, AUTOMATION_NOTIFICATION_POLICY_RUNTIME_CAPABILITY]
      })
      callRuntimeRpc.mockResolvedValue({ automation: { id: 'a1' } })
      await createAutomationForDestination(
        RUNTIME,
        { ...INPUT, notifyOnFailure },
        { selector: { kind: 'self' } }
      )
      await updateAutomationForOwner(OWNER, 'a1', { notifyOnFailure })
      expect(callRuntimeRpc.mock.calls[0]?.[2]).toMatchObject({ notifyOnFailure })
      expect(callRuntimeRpc.mock.calls[1]?.[2]).toMatchObject({ updates: { notifyOnFailure } })
    }
  )

  it('guards the older environment-only update path too', async () => {
    const { updateAutomationForTarget } = await import('./automation-host-client')
    getRuntimeEnvironmentStatus.mockResolvedValue({ capabilities: LEGACY_CAPABILITIES })
    await expect(
      updateAutomationForTarget(
        makeAutomation(),
        { notifyOnFailure: false },
        { kind: 'environment', environmentId: 'env-1' }
      )
    ).rejects.toThrow('Configuring automation alerts requires a newer Orca server')
    expect(callRuntimeRpc).not.toHaveBeenCalled()
  })
})
