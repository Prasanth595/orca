import { useEffect, useLayoutEffect, useRef } from 'react'
import { useMobileChatCheckpoint } from './use-mobile-chat-checkpoint'
import { createMobileChatReadCache } from '../cache/mobile-chat-read-cache'
import { getTerminalRecordsFromSessionTabs } from './mobile-terminal-records'
import type { RpcClient } from '../transport/rpc-client'
import type { MobileSessionKeyboardStateModel } from './use-mobile-session-keyboard-state'
import type { MobileSessionTab } from './mobile-session-route-types'

type CachedTabs = { tabs: MobileSessionTab[]; activeTabId: string | null }
const routeTabs = createMobileChatReadCache<CachedTabs>('session-tabs', {
  valid: (value) =>
    typeof value === 'object' &&
    value !== null &&
    'tabs' in value &&
    Array.isArray(value.tabs) &&
    value.tabs.every(
      (tab) =>
        tab &&
        typeof tab.id === 'string' &&
        ['terminal', 'agent-session', 'markdown', 'file', 'browser'].includes(tab.type)
    ),
  compact: (value) => value
})
export function cacheMobileSessionTabs(
  client: RpcClient,
  hostId: string,
  worktreeId: string,
  tabs: MobileSessionTab[],
  activeTabId: string | null
): void {
  routeTabs.set(client, JSON.stringify([hostId, worktreeId]), { tabs, activeTabId })
}
type Scope = Pick<
  MobileSessionKeyboardStateModel,
  | 'client'
  | 'hostId'
  | 'worktreeId'
  | 'created'
  | 'sessionTabs'
  | 'activeSessionTabId'
  | 'terminalsLoaded'
  | 'setSessionTabs'
  | 'setActiveSessionTabId'
  | 'setTerminals'
  | 'setActiveHandle'
>

/** Restores presentation only; live tab publication still owns selection and input authority. */
export function useMobileCachedSessionTabs(scope: Scope): void {
  const { client, hostId, worktreeId, created, sessionTabs, activeSessionTabId, terminalsLoaded } =
    scope
  const key = JSON.stringify([hostId, worktreeId])
  const latest = useRef<{ client: RpcClient; key: string; value: CachedTabs } | null>(null)
  useLayoutEffect(() => {
    if (client && terminalsLoaded) {
      latest.current = {
        client,
        key,
        value: { tabs: sessionTabs, activeTabId: activeSessionTabId }
      }
    }
  }, [client, key, sessionTabs, activeSessionTabId, terminalsLoaded])
  useMobileChatCheckpoint(() => {
    const entry = latest.current
    if (entry) {
      routeTabs.set(entry.client, entry.key, entry.value)
    }
  })
  useEffect(() => {
    if (!client) {
      return
    }
    let cancelled = false
    const restore = (cached: CachedTabs | null): void => {
      if (
        cached &&
        Array.isArray(cached.tabs) &&
        !cancelled &&
        !(latest.current?.key === key && latest.current.client === client)
      ) {
        scope.setSessionTabs(cached.tabs)
        scope.setActiveSessionTabId(cached.activeTabId)
        scope.setTerminals(getTerminalRecordsFromSessionTabs(cached.tabs))
        const active = cached.tabs.find((tab) => tab.id === cached.activeTabId)
        scope.setActiveHandle(active?.type === 'terminal' ? (active.terminal ?? null) : null)
      }
    }
    restore(created === '1' ? null : routeTabs.get(client, key))
    if (created !== '1') {
      void routeTabs.restore(client, key).then(restore)
    }
    return () => {
      cancelled = true
      const entry = latest.current
      if (entry?.client === client && entry.key === key) {
        routeTabs.set(client, key, entry.value)
      }
    }
  }, [client, key])
}
