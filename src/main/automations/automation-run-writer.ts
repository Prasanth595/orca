import type { Store } from '../persistence'
import type { PublishAutomationsChanged } from '../../shared/runtime-client-events'
import type { AutomationDispatchResult, AutomationRun } from '../../shared/automations-types'
import { automationRunAlert, type AutomationRunAlert } from '../../shared/automation-run-alert'

type DurableWrite<T extends (...args: never[]) => unknown> = (
  ...args: Parameters<T>
) => Promise<ReturnType<T>>

export type AutomationRunWriter = {
  createRun: DurableWrite<Store['createAutomationRun']>
  updateRun: DurableWrite<Store['updateAutomationRun']>
  /** Null when nothing could be folded — the caller then writes an ordinary run. */
  repeatSkip: DurableWrite<Store['recordRepeatedAutomationSkip']>
  advanceNextRun: DurableWrite<Store['advanceAutomationNextRun']>
}

/** Wraps run persistence so every committed write announces itself. Clients with
 *  the Automations page closed — or none attached at all — have no other way to
 *  learn that a run progressed, so the event must follow the write, not a render. */
export function createAutomationRunWriter(
  store: Pick<
    Store,
    | 'createAutomationRun'
    | 'updateAutomationRun'
    | 'recordRepeatedAutomationSkip'
    | 'advanceAutomationNextRun'
    | 'automationChangeSelector'
    | 'flushPendingOrThrowAsync'
    | 'listAutomationRuns'
  >,
  publish: PublishAutomationsChanged | null
): AutomationRunWriter {
  const pendingAlerts = new Map<string, AutomationRunAlert>()
  // A run write never moves the record, so its own host is the whole publication.
  // A record that can no longer be named degrades to the authority-wide event.
  const announce = (
    automationId: string,
    reason: 'run' | 'usage',
    alert?: AutomationRunAlert
  ): void => {
    if (!publish) {
      return
    }
    const selector = store.automationChangeSelector(automationId)
    publish({ reason, ...(selector ? { selector } : {}), ...(alert ? { alert } : {}) })
  }
  return {
    advanceNextRun: async (id, now) => {
      const automation = store.advanceAutomationNextRun(id, now)
      await store.flushPendingOrThrowAsync({ drainToStableGeneration: false })
      return automation
    },
    createRun: async (automation, scheduledFor, trigger): Promise<AutomationRun> => {
      const run = store.createAutomationRun(automation, scheduledFor, trigger)
      await store.flushPendingOrThrowAsync({ drainToStableGeneration: false })
      announce(automation.id, 'run')
      return run
    },
    updateRun: async (result: AutomationDispatchResult): Promise<AutomationRun> => {
      const previous = publish
        ? store.listAutomationRuns().find((entry) => entry.id === result.runId)
        : null
      const run = store.updateAutomationRun(result)
      const alert = automationRunAlert(run)
      if (publish && alert && previous?.status !== 'dispatch_failed') {
        pendingAlerts.set(run.id, alert)
      }
      await store.flushPendingOrThrowAsync({ drainToStableGeneration: false })
      const pending = pendingAlerts.get(run.id)
      pendingAlerts.delete(run.id)
      announce(run.automationId, result.usage ? 'usage' : 'run', pending)
      return run
    },
    repeatSkip: async (automationId, error, scheduledFor): Promise<AutomationRun | null> => {
      const run = store.recordRepeatedAutomationSkip(automationId, error, scheduledFor)
      if (run) {
        await store.flushPendingOrThrowAsync({ drainToStableGeneration: false })
        announce(automationId, 'run')
      }
      return run
    }
  }
}
