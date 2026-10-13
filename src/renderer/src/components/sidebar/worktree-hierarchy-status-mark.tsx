import React from 'react'
import { translate } from '@/i18n/i18n'
import type { WorktreeStatus } from '@/lib/worktree-status'
import StatusIndicator from './StatusIndicator'
import { useWorktreeActivityStatus } from './use-worktree-activity-status'

export type HierarchyStatusMark = 'input' | 'failed' | 'working' | 'unread' | null

// Why: the hierarchy row shows one mark; waiting-on-you outranks everything. A finished agent
// surfaces as unread until seen, then the row goes quiet — "done and seen" isn't a status.
export function resolveHierarchyStatusMark(
  status: WorktreeStatus,
  isUnread: boolean
): HierarchyStatusMark {
  if (status === 'permission') {
    return 'input'
  }
  if (status === 'failed') {
    return 'failed'
  }
  if (status === 'working' || status === 'monitoring') {
    return 'working'
  }
  return isUnread ? 'unread' : null
}

export function WorktreeHierarchyStatusMark({
  worktreeId,
  isUnread
}: {
  worktreeId: string
  isUnread: boolean
}): React.JSX.Element | null {
  const status = useWorktreeActivityStatus(worktreeId)
  const mark = resolveHierarchyStatusMark(status, isUnread)
  if (mark === null) {
    return null
  }
  if (mark === 'unread') {
    return (
      <span
        role="img"
        className="size-1.5 shrink-0 rounded-full bg-foreground"
        aria-label={translate('sidebar.hierarchy.status.unread', 'Unread')}
      />
    )
  }
  return <StatusIndicator status={status} />
}
