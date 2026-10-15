import { isRemoteExecutionHostPtyId } from '../../../../shared/remote-execution-host-pty-id'
import type { TerminalLayoutSnapshot } from '../../../../shared/terminal-tab-types'
import { collectLeafIdsInOrder } from '@/components/terminal-pane/terminal-layout-leaf-ids'
import type { AppState } from '../types'
import type { TerminalStoreGet, TerminalStoreSet } from './terminal-state'
import { resolvePrimaryLayoutPtyId } from './terminal-pty-identities'

export type TerminalDetachTarget = {
  ptyId: string | null
  remoteUnsupported: boolean
  splitUnsupported: boolean
  title: string
}

function countLayoutLeaves(layout: TerminalLayoutSnapshot | undefined): number {
  if (!layout) {
    return 1
  }
  if (layout.root) {
    return collectLeafIdsInOrder(layout.root).length
  }
  return Math.max(1, Object.keys(layout.ptyIdsByLeafId ?? {}).length)
}

export function resolveTerminalDetachTarget(
  state: Pick<AppState, 'tabsByWorktree' | 'terminalLayoutsByTabId'>,
  tabId: string
): TerminalDetachTarget | null {
  const tab = Object.values(state.tabsByWorktree)
    .flat()
    .find((candidate) => candidate.id === tabId)
  if (!tab) {
    return null
  }
  const layout = state.terminalLayoutsByTabId[tabId]
  const ptyId = layout ? resolvePrimaryLayoutPtyId(layout) : tab.ptyId
  return {
    ptyId,
    remoteUnsupported: ptyId ? isRemoteExecutionHostPtyId(ptyId) : false,
    splitUnsupported: countLayoutLeaves(layout) > 1,
    title: tab.customTitle ?? tab.title
  }
}

function withoutTab(
  detachedTerminalByTabId: AppState['detachedTerminalByTabId'],
  tabId: string
): AppState['detachedTerminalByTabId'] {
  if (!(tabId in detachedTerminalByTabId)) {
    return detachedTerminalByTabId
  }
  const next = { ...detachedTerminalByTabId }
  delete next[tabId]
  return next
}

export function createTerminalDetachmentActions(set: TerminalStoreSet, get: TerminalStoreGet) {
  return {
    detachTerminalTab: async (tabId: string): Promise<boolean> => {
      const target = resolveTerminalDetachTarget(get(), tabId)
      const ptyId = target?.ptyId
      if (!target || !ptyId || target.remoteUnsupported || target.splitUnsupported) {
        return false
      }
      await window.api.detachedTerminal.open({
        tabId,
        ptyId,
        title: target.title
      })
      set((state) => ({
        detachedTerminalByTabId: {
          ...state.detachedTerminalByTabId,
          [tabId]: { ptyId }
        }
      }))
      return true
    },
    redockDetachedTerminalTab: (tabId: string): void => {
      set((state) => ({
        detachedTerminalByTabId: withoutTab(state.detachedTerminalByTabId, tabId)
      }))
    },
    closeDetachedTerminalWindow: (tabId: string): void => {
      if (!(tabId in get().detachedTerminalByTabId)) {
        return
      }
      void window.api.detachedTerminal.close(tabId)
      set((state) => ({
        detachedTerminalByTabId: withoutTab(state.detachedTerminalByTabId, tabId)
      }))
    },
    focusDetachedTerminalWindow: (tabId: string): void => {
      const target = resolveTerminalDetachTarget(get(), tabId)
      if (tabId in get().detachedTerminalByTabId && target?.ptyId) {
        void window.api.detachedTerminal.open({ tabId, ptyId: target.ptyId, title: target.title })
      }
    }
  }
}
