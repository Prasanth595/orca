import { useCallback } from 'react'
import { useAutomationInbox } from './use-automation-inbox'

export function useActivityInboxReadControls(hasUnreadAgents: boolean, markAgentsRead: () => void) {
  const { unreadCount, markAllRead } = useAutomationInbox()
  const markAllReadEntries = useCallback(() => {
    markAgentsRead()
    markAllRead()
  }, [markAgentsRead, markAllRead])
  return { hasUnreadEntries: hasUnreadAgents || unreadCount > 0, markAllReadEntries }
}
