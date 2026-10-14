import {
  changeAutomationInboxEntries,
  mergeAutomationInboxEntries,
  normalizeAutomationInboxEntries,
  type AutomationInboxEntries
} from '../../../../../shared/automation-inbox'
import type { UISliceGet, UISliceSet } from './ui-slice-contract'

export type AutomationInboxActions = {
  automationInboxEntries: AutomationInboxEntries
  receiveAutomationInbox: (incoming: AutomationInboxEntries) => void
  changeAutomationInbox: (keys: readonly string[], action: 'read' | 'unread' | 'dismiss') => void
}

export function createUiAutomationInboxActions(
  set: UISliceSet,
  _get: UISliceGet
): AutomationInboxActions {
  return {
    automationInboxEntries: {},
    receiveAutomationInbox: (incoming) =>
      set((state) => {
        const entries = mergeAutomationInboxEntries(
          state.automationInboxEntries,
          normalizeAutomationInboxEntries(incoming)
        )
        return entries === state.automationInboxEntries
          ? state
          : { automationInboxEntries: entries }
      }),
    changeAutomationInbox: (keys, action) =>
      set((state) => {
        const entries = changeAutomationInboxEntries(state.automationInboxEntries, keys, action)
        return entries === state.automationInboxEntries
          ? state
          : { automationInboxEntries: entries }
      })
  }
}
