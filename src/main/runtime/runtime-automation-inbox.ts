import type { AutomationsChangedPayload } from '../../shared/runtime-client-events'
import type { RuntimeStore } from './runtime-store-contract'

export async function listRuntimeAutomationInbox(
  store: RuntimeStore | null
): Promise<AutomationsChangedPayload[]> {
  if (!store?.listAutomationInbox) {
    throw new Error('runtime_unavailable')
  }
  const alerts = store.listAutomationInbox()
  await store.flushPendingOrThrowAsync?.({ drainToStableGeneration: false })
  return alerts
}
