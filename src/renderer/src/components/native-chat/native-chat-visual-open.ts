import {
  getWorkspaceFilePreviewPlan,
  openFileInBrowserTab,
  type WorkspaceFilePreviewPlan
} from '@/lib/file-preview'
import { hostPathFilePreviewPlan } from '@/lib/host-path-file-preview'
import { useAppStore } from '@/store'
import type { NativeChatVisualOwner } from './native-chat-visual-owner'

/**
 * How the chat's own host renders the visual's file as an ordinary document: a browser tab on
 * this computer's file, or the paired host's document preview. Null where the workspace's
 * ordinary preview would read another machine's file, which only the visual tab avoids.
 */
function nativeChatVisualFilePlan(
  owner: NativeChatVisualOwner,
  path: string
): WorkspaceFilePreviewPlan | null {
  const plan = getWorkspaceFilePreviewPlan(useAppStore.getState(), owner.worktreeId, path)
  if (owner.target.kind === 'local') {
    return plan.status === 'browser-tab' ? plan : null
  }
  // The scratch folder is outside every workspace, so the workspace's host refuses it by name;
  // only when that host is the chat's own does its by-path preview show this chat's file.
  if (
    plan.status !== 'unsupported' ||
    plan.reason !== 'outside-worktree' ||
    plan.environmentId !== owner.target.environmentId
  ) {
    return null
  }
  const hostPlan = hostPathFilePreviewPlan()
  return hostPlan.status === 'doc-preview' ? hostPlan : null
}

/**
 * Opens a chat visual the way any file of its kind opens. `path` is the visual's absolute path on
 * the chat's host, known only when that host serves its scratch folder by path; otherwise, and
 * where no ordinary preview reaches the chat's host, the visual opens in its own tab.
 */
export function openNativeChatVisual(
  owner: NativeChatVisualOwner,
  visual: { file: string; title: string | null; path: string | null }
): void {
  const plan = visual.path === null ? null : nativeChatVisualFilePlan(owner, visual.path)
  if (visual.path !== null && plan !== null) {
    openFileInBrowserTab({
      filePath: visual.path,
      worktreeId: owner.worktreeId,
      plan: plan.status === 'browser-tab' && visual.title ? { ...plan, title: visual.title } : plan
    })
    return
  }
  useAppStore.getState().openChatVisualTab(owner.worktreeId, {
    target: owner.target,
    sessionId: owner.sessionId,
    file: visual.file,
    title: visual.title
  })
}
