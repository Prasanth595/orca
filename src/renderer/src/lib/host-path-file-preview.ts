import { webClientDocPreviewRefusal } from '@/lib/doc-preview-web-client'
import type { WorkspaceFilePreviewPlan } from '@/lib/file-preview'
import { statHostPathFile } from '@/components/terminal-pane/terminal-host-workspace-file'
import type { AppState } from '@/store/types'

type OutsideWorktreePlan = Extract<WorkspaceFilePreviewPlan, { reason: 'outside-worktree' }>

/** A paired document outside its workspace, once its host has said it serves that path. */
export function hostPathFilePreviewPlan(): WorkspaceFilePreviewPlan {
  return webClientDocPreviewRefusal() ?? { status: 'doc-preview' }
}

// Why short: the reader is waiting on a click, and a slow host keeps today's refusal instead.
const HOST_PATH_PREVIEW_STAT_TIMEOUT_MS = 5_000

/**
 * Asks the host that refused a document outside the opening workspace whether it serves that path
 * (its workspaces and its chat scratch folder). Why it may wait for the host's status: this runs on
 * an explicit click, so the first click after a restart opens the page rather than refusing it; the
 * status probe is bounded and a failed one is not retried for a while. Any other path, an older or
 * unreachable host, or a failed check keeps the refusal.
 */
export async function resolveHostPathFilePreviewPlan(
  state: AppState,
  document: { worktreeId: string; filePath: string },
  refusal: OutsideWorktreePlan
): Promise<WorkspaceFilePreviewPlan> {
  try {
    const served = await statHostPathFile(
      {
        target: { kind: 'environment', environmentId: refusal.environmentId },
        worktreeId: document.worktreeId,
        worktreePath: state.getKnownWorktreeById(document.worktreeId)?.path ?? null
      },
      document.filePath,
      HOST_PATH_PREVIEW_STAT_TIMEOUT_MS
    )
    return served && !served.isDirectory ? hostPathFilePreviewPlan() : refusal
  } catch {
    return refusal
  }
}
