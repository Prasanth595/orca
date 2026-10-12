import { useAppStore } from '@/store'
import { callRuntimeRpc, type RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { getRuntimeEnvironmentRevision } from '@/runtime/runtime-environment-revision'
import { getRuntimeEnvironmentConnectionGeneration } from '@/store/slices/runtime-status'
import { AUTOMATION_INBOX_RUNTIME_CAPABILITY } from '../../../shared/automation-runtime-capabilities'
import type { AutomationsChangedPayload } from '../../../shared/runtime-client-events'
import { receiveAutomationRunInboxBatch } from './automation-run-alert-delivery'

const inFlight = new Map<string, Promise<void>>()

export function refreshAutomationInbox(target: RuntimeClientTarget): Promise<void> {
  const state = useAppStore.getState()
  if (!state.persistedUIReady) {
    return Promise.resolve()
  }
  const environmentId = target.kind === 'environment' ? target.environmentId : null
  const revision = environmentId ? getRuntimeEnvironmentRevision(environmentId) : null
  const generation = environmentId ? getRuntimeEnvironmentConnectionGeneration(environmentId) : null
  const profileId = state.activeOrcaProfileId
  const key = `${encodeURIComponent(profileId ?? '')}:${encodeURIComponent(environmentId ?? '')}:${revision}:${generation}`
  const pending = inFlight.get(key)
  if (pending) {
    return pending
  }
  const request = (async () => {
    const status = await callRuntimeRpc<{ capabilities?: string[] }>(
      target,
      'status.get',
      undefined,
      { timeoutMs: 15_000 }
    )
    if (!status?.capabilities?.includes(AUTOMATION_INBOX_RUNTIME_CAPABILITY)) {
      return
    }
    const result = await callRuntimeRpc<{ alerts: AutomationsChangedPayload[] }>(
      target,
      'automation.inbox',
      undefined,
      { timeoutMs: 15_000 }
    )
    if (
      profileId !== useAppStore.getState().activeOrcaProfileId ||
      !useAppStore.getState().persistedUIReady
    ) {
      return
    }
    if (
      environmentId &&
      (revision !== getRuntimeEnvironmentRevision(environmentId) ||
        generation !== getRuntimeEnvironmentConnectionGeneration(environmentId))
    ) {
      return
    }
    receiveAutomationRunInboxBatch(result.alerts.map((alert) => ({ ...alert, environmentId })))
  })().finally(() => {
    if (inFlight.get(key) === request) {
      inFlight.delete(key)
    }
  })
  inFlight.set(key, request)
  return request
}
