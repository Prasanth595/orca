import type { ExecutionHostScope } from '../../../shared/execution-host'
import type { FeishuBitableRecordReference } from '../../../shared/feishu-bitable-task-contract'
import { isSameFeishuBitableRecord } from '../../../shared/feishu-bitable-types'
import { getWorkspaceAttachments } from '../../../shared/workspace-attachments'
import type { Worktree } from '../../../shared/worktree/types'

/**
 * Finds the workspace already attached to a Bitable record. Identity is the
 * full record tuple (connection + app + table + record), never the title, so
 * a renamed row still dedupes and a same-titled row in another table does not.
 */
export function findFeishuBitableRecordWorkspaceAttachment(
  worktrees: readonly Worktree[],
  reference: FeishuBitableRecordReference,
  sourceHostId?: ExecutionHostScope
): Worktree | null {
  let best: Worktree | null = null
  for (const worktree of worktrees) {
    if (worktree.isArchived) {
      continue
    }
    const attached = getWorkspaceAttachments(worktree).some(
      (item) =>
        item.provider === 'feishu-bitable' &&
        (!sourceHostId || item.taskSourceContext?.hostId === sourceHostId) &&
        isSameFeishuBitableRecord(item.feishuRecord, reference)
    )
    if (attached && (!best || worktree.lastActivityAt > best.lastActivityAt)) {
      best = worktree
    }
  }
  return best
}
