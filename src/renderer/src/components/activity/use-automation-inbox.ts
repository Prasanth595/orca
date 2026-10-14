import { useCallback, useMemo } from 'react'
import { useAppStore } from '@/store'
import { parseHostStableKey } from '../../../../shared/automation-owner-key'
import {
  countAutomationInboxUnread,
  type AutomationInboxEntries
} from '../../../../shared/automation-inbox'
import { automationRunNotificationRequest } from '../../../../shared/automation-run-alert'
import { openAutomationRunNotification } from '@/lib/automation-run-alert-delivery'
import { isActivitySearchQueryTooLarge } from './activity-thread-grouping'
import type { ThreadReadFilter } from './activity-thread-types'

const EMPTY: AutomationInboxEntries = {}

export function useAutomationInbox(query = '', readFilter: ThreadReadFilter = 'all') {
  const entries = useAppStore((state) => state.automationInboxEntries) ?? EMPTY
  const change = useCallback((keys: readonly string[], action: 'read' | 'unread' | 'dismiss') => {
    const state = useAppStore.getState()
    if (!keys.length) {
      return
    }
    state.changeAutomationInbox(keys, action)
    if (action !== 'unread') {
      const ids = keys.flatMap((key) => {
        const entry = state.automationInboxEntries[key]
        const id = entry && automationRunNotificationRequest(entry.alert).notificationId
        return id ? [id] : []
      })
      void window.api?.notifications?.dismiss?.(ids)
    }
  }, [])
  const items = useMemo(() => {
    if (isActivitySearchQueryTooLarge(query)) {
      return []
    }
    const needle = query.trim().toLocaleLowerCase()
    return Object.entries(entries)
      .filter(
        ([, entry]) =>
          !entry.dismissed &&
          (readFilter !== 'unread' || !entry.read) &&
          (!needle ||
            `${entry.alert.title} ${entry.alert.message}`.toLocaleLowerCase().includes(needle))
      )
      .sort((a, b) => b[1].alert.createdAt - a[1].alert.createdAt || a[0].localeCompare(b[0]))
  }, [entries, query, readFilter])
  const open = useCallback(
    (key: string) => {
      const entry = useAppStore.getState().automationInboxEntries[key]
      if (!entry) {
        return
      }
      const catalogRef = parseHostStableKey(entry.catalogKey)
      if (!catalogRef) {
        return
      }
      change([key], 'read')
      openAutomationRunNotification({ ...entry.alert, catalogRef })
    },
    [change]
  )
  const markAllRead = useCallback(() => {
    change(
      Object.keys(entries).filter((key) => !entries[key].dismissed && !entries[key].read),
      'read'
    )
  }, [entries, change])
  return { items, open, change, markAllRead, unreadCount: countAutomationInboxUnread(entries) }
}
