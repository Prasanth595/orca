import { RuntimeHeadlessTabGroups } from '../session-tabs/headless-tab-group-moves'
import { parsePaneKey } from '../../../shared/stable-pane-id'

export abstract class RuntimeWorkspaceSessionCustomTitles extends RuntimeHeadlessTabGroups {
  protected readonly inMemorySessionCustomTitles = new Map<string, string>()

  getSessionCustomTitle(sessionId: string): string | null {
    if (!sessionId) {
      return null
    }
    const titles = this.store?.getWorkspaceSession?.()?.sessionCustomTitles
    const lookup = (id: string) => this.inMemorySessionCustomTitles.get(id) ?? titles?.[id] ?? null

    const direct = lookup(sessionId)
    if (direct) {
      return direct
    }
    if (sessionId.includes(':')) {
      const parts = sessionId.split(':')
      const bare = parts.at(-1)
      if (bare) {
        const title = lookup(bare)
        if (title) {
          return title
        }
      }
    }
    return null
  }

  setSessionCustomTitle(sessionId: string, title: string | null): void {
    if (!sessionId) {
      return
    }
    const normalized = title?.trim() || null
    if (normalized) {
      this.inMemorySessionCustomTitles.set(sessionId, normalized)
    } else {
      this.inMemorySessionCustomTitles.delete(sessionId)
    }
    const session = this.store?.getWorkspaceSession?.()
    if (!session || !this.store?.setWorkspaceSession) {
      return
    }
    const nextTitles = { ...session.sessionCustomTitles }
    if (normalized) {
      nextTitles[sessionId] = normalized
    } else {
      delete nextTitles[sessionId]
    }
    this.store.setWorkspaceSession({
      ...session,
      sessionCustomTitles: nextTitles
    })
  }

  readLiveTerminalCustomTitle(args: { tabId?: string; terminalHandle?: string }): string | null {
    if (args.terminalHandle) {
      const live = this.getLivePtyForHandle(args.terminalHandle)?.pty.customTitle?.trim()
      if (live) {
        return live
      }
      const record = this.handles.get(args.terminalHandle)
      const recorded = record?.ptyId ? this.ptysById.get(record.ptyId)?.customTitle?.trim() : null
      if (recorded) {
        return recorded
      }
      const handleTab = record?.tabId ? this.tabs.get(record.tabId)?.customTitle?.trim() : null
      if (handleTab) {
        return handleTab
      }
    }
    if (!args.tabId) {
      return null
    }
    const tabTitle = this.tabs.get(args.tabId)?.customTitle?.trim()
    if (tabTitle) {
      return tabTitle
    }
    for (const pty of this.ptysById.values()) {
      if (pty.tabId === args.tabId && pty.customTitle?.trim()) {
        return pty.customTitle.trim()
      }
    }
    for (const leaf of this.leaves.values()) {
      if (leaf.tabId === args.tabId && leaf.ptyId) {
        const title = this.ptysById.get(leaf.ptyId)?.customTitle?.trim()
        if (title) {
          return title
        }
      }
    }
    return null
  }

  protected rememberTerminalSessionTitle(
    tabId: string | null | undefined,
    handle: string | undefined,
    title: string | null
  ): void {
    if (!tabId) {
      return
    }
    const sessionId = this.resolveSessionIdForTab(tabId, handle)
    if (sessionId) {
      this.setSessionCustomTitle(sessionId, title)
    }
  }

  resolveSessionIdForTab(tabId: string, handle?: string): string | null {
    const inMemoryTab = this.tabs.get(tabId)
    if (inMemoryTab?.aiVaultTitle?.sessionId) {
      return inMemoryTab.aiVaultTitle.sessionId
    }
    const session = this.store?.getWorkspaceSession?.()
    if (session) {
      for (const tabs of Object.values(session.tabsByWorktree)) {
        const persisted = tabs.find((tab) => tab.id === tabId)
        if (persisted?.aiVaultTitle?.sessionId) {
          return persisted.aiVaultTitle.sessionId
        }
      }
      if (session.unifiedTabs) {
        for (const tabs of Object.values(session.unifiedTabs)) {
          const unified = tabs.find((tab) => tab.entityId === tabId || tab.id === tabId)
          if (unified?.aiVaultTitle?.sessionId) {
            return unified.aiVaultTitle.sessionId
          }
          if (unified?.contentType === 'agent-session' && unified.entityId) {
            return unified.entityId
          }
        }
      }
    }
    const paneKeys: string[] = []
    for (const leaf of this.leaves.values()) {
      if (leaf.tabId === tabId) {
        paneKeys.push(this.makeRuntimePaneKey(leaf))
      }
    }
    for (const entry of this.getAgentStatusSnapshotFn?.() ?? []) {
      const parsedTabId = parsePaneKey(entry.paneKey)?.tabId
      const matches =
        (Boolean(handle) && entry.terminalHandle === handle) ||
        entry.tabId === tabId ||
        parsedTabId === tabId ||
        paneKeys.includes(entry.paneKey)
      if (matches && entry.providerSession?.id) {
        return entry.providerSession.id
      }
    }
    for (const leaf of this.leaves.values()) {
      if (leaf.tabId !== tabId || !leaf.ptyId) {
        continue
      }
      const recorded = this.ptysById.get(leaf.ptyId)?.providerSessionId
      if (recorded) {
        return recorded
      }
    }
    if (handle) {
      const recorded = this.getLivePtyForHandle(handle)?.pty.providerSessionId
      if (recorded) {
        return recorded
      }
    }
    for (const leaf of this.leaves.values()) {
      if (leaf.tabId === tabId) {
        const paneKey = this.makeRuntimePaneKey(leaf)
        const entries =
          this.getAgentStatusSnapshotForPaneFn?.(paneKey) ??
          this.getAgentStatusSnapshotFn?.().filter((row) => row.paneKey === paneKey) ??
          []
        for (const entry of entries) {
          if (entry.providerSession?.id) {
            return entry.providerSession.id
          }
        }
      }
    }
    for (const snapshot of this.mobileSessionTabsByWorktree.values()) {
      for (const tab of snapshot.tabs) {
        if (tab.id === tabId || (tab.type === 'terminal' && tab.parentTabId === tabId)) {
          if (tab.type === 'agent-session' && tab.sessionId) {
            return tab.sessionId
          }
          if ('agentStatus' in tab && tab.agentStatus?.providerSession?.id) {
            return tab.agentStatus.providerSession.id
          }
        }
      }
    }
    if (tabId.startsWith('agent-session:')) {
      return tabId.slice('agent-session:'.length)
    }
    return null
  }
}
