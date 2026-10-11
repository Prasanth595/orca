import type {
  WorkspaceSessionPatch,
  WorkspaceSessionState
} from '../../../shared/workspace-session-state-types'
import {
  collectTerminalScrollbackSnapshotRefs,
  deleteTerminalScrollbackSnapshotSync,
  type TerminalScrollbackSnapshotStorage
} from '../../terminal-scrollback-snapshots'
import type { StoreRuntimeState } from './store-runtime-state'

// Why localOnlyScrollbackByTabId is deliberately NOT here despite TERMINAL_SCROLLBACK_SESSION_HOMES
// pairing it with terminalLayoutsByTabId: full normalization reaches the fail-closed strip in
// workspace-session-terminal-buffers.ts, which drops a leaf whose worktree main cannot attribute —
// the renderer already capped that field with attribution in hand, and re-stripping it here is the
// scrollback loss the local-only home exists to prevent. Add it only together with that strip.
const WORKSPACE_SESSION_PATCH_FULL_NORMALIZATION_KEYS = new Set<keyof WorkspaceSessionState>([
  'tabsByWorktree',
  'terminalLayoutsByTabId'
])

export function workspaceSessionPatchNeedsFullNormalization(patch: WorkspaceSessionPatch): boolean {
  return Object.keys(patch).some((key) =>
    WORKSPACE_SESSION_PATCH_FULL_NORMALIZATION_KEYS.has(key as keyof WorkspaceSessionState)
  )
}

export function deleteRemovedTerminalScrollbackSnapshots(
  prior: WorkspaceSessionState | undefined,
  next: WorkspaceSessionState,
  storage?: TerminalScrollbackSnapshotStorage,
  /** Refs a pending migration export still reads; they outlive the session row. */
  retainedRefs: ReadonlySet<string> = new Set(),
  deferredDeletions: Set<string> | null = null
): void {
  if (!prior) {
    return
  }
  const nextRefs = collectTerminalScrollbackSnapshotRefs(next)
  for (const ref of collectTerminalScrollbackSnapshotRefs(prior)) {
    if (!nextRefs.has(ref) && !retainedRefs.has(ref)) {
      if (deferredDeletions) {
        deferredDeletions.add(ref)
      } else {
        deleteTerminalScrollbackSnapshotSync(ref, storage)
      }
    }
  }
}

/** A refused mutation may restore these refs; release files only after its compensation settles. */
export function finishMutationScrollbackDeletions(
  runtime: Pick<
    StoreRuntimeState,
    | 'deferredMutationScrollbackDeletions'
    | 'state'
    | 'terminalScrollbackSnapshotStorage'
    | 'retainedScrollbackRefsByMigrationId'
  >
): void {
  const deferred = runtime.deferredMutationScrollbackDeletions
  runtime.deferredMutationScrollbackDeletions = null
  if (!deferred?.size) {
    return
  }
  const sessions = [
    runtime.state.workspaceSession,
    ...Object.values(runtime.state.workspaceSessionsByHostId ?? {})
  ]
  const retained = new Set([
    ...sessions.flatMap((session) =>
      session ? [...collectTerminalScrollbackSnapshotRefs(session)] : []
    ),
    ...[...runtime.retainedScrollbackRefsByMigrationId.values()].flatMap((refs) => [...refs])
  ])
  for (const ref of deferred) {
    if (!retained.has(ref)) {
      deleteTerminalScrollbackSnapshotSync(ref, runtime.terminalScrollbackSnapshotStorage)
    }
  }
}
