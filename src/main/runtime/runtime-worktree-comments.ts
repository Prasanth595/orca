import type { DiffComment } from '../../shared/diff-comment-types'
import type {
  RuntimeCommentEditResult,
  RuntimeCommentListResult,
  RuntimeCommentRecord,
  RuntimeCommentRemoveResult
} from '../../shared/runtime-comment-contracts'
import { isRemovedFolderWorkspaceInstance } from '../folder-workspace-meta-presence'
import type { RuntimeStore } from './runtime-store-contract'
import type { ResolvedWorktree } from './runtime-worktree-path-identity'

type CommentStore = Pick<
  RuntimeStore,
  | 'getRepos'
  | 'getWorktreeMeta'
  | 'getWorktreeMetaForHost'
  | 'setWorktreeMeta'
  | 'setWorktreeMetaForHost'
>

type Ports = {
  resolveWorktree: (selector: string) => Promise<ResolvedWorktree>
  invalidateResolved: () => void
  notifyChanged: (repoId: string) => void
}

export const COMMENT_NOT_FOUND_CODE = 'comment_not_found'

export function toRuntimeCommentRecord(comment: DiffComment): RuntimeCommentRecord {
  return {
    id: comment.id,
    filePath: comment.filePath,
    source: comment.source === 'markdown' ? 'markdown' : 'diff',
    line: comment.lineNumber,
    ...(comment.startLine !== undefined ? { startLine: comment.startLine } : {}),
    ...(comment.selectedText !== undefined ? { selectedText: comment.selectedText } : {}),
    body: comment.body,
    createdAt: comment.createdAt,
    ...(comment.updatedAt !== undefined ? { updatedAt: comment.updatedAt } : {}),
    ...(comment.sentAt !== undefined ? { sentAt: comment.sentAt } : {})
  }
}

// Why: a Windows caller types `docs\notes.md` while the renderer stores `docs/notes.md`.
function comparableFilePath(filePath: string): string {
  return filePath.replaceAll('\\', '/').replace(/^(\.\/)+/, '')
}

function executionHostOf(worktree: ResolvedWorktree) {
  return worktree.identity?.executionHostId ?? worktree.hostId
}

// Why the store and not the resolved worktree: the resolved rows are cached for a second, and a
// full-list write built from a stale row would drop a note the user saved in that second.
function readStoredComments(store: CommentStore, worktree: ResolvedWorktree): DiffComment[] {
  const executionHostId = executionHostOf(worktree)
  const meta =
    executionHostId && store.getWorktreeMetaForHost
      ? store.getWorktreeMetaForHost(worktree.id, executionHostId)
      : store.getWorktreeMeta(worktree.id)
  return Array.isArray(meta?.diffComments) ? meta.diffComments : []
}

export async function listRuntimeWorktreeComments(args: {
  selector: string
  filePath?: string
  source?: 'markdown' | 'diff'
  store: CommentStore
  ports: Pick<Ports, 'resolveWorktree'>
}): Promise<RuntimeCommentListResult> {
  const worktree = await args.ports.resolveWorktree(args.selector)
  const wantedPath = args.filePath === undefined ? undefined : comparableFilePath(args.filePath)
  const comments = readStoredComments(args.store, worktree)
    .map(toRuntimeCommentRecord)
    .filter(
      (comment) =>
        (wantedPath === undefined || comparableFilePath(comment.filePath) === wantedPath) &&
        (args.source === undefined || comment.source === args.source)
    )
    // Why: read top to bottom, file by file, the way the document does.
    .sort(
      (a, b) => a.filePath.localeCompare(b.filePath) || a.line - b.line || a.createdAt - b.createdAt
    )
  return { worktree: worktree.id, comments }
}

/**
 * Why one function for every write: the read, the change and the save must happen with no await
 * between them, so a note the window saves while this runs cannot be overwritten by a stale list.
 */
async function changeRuntimeWorktreeComments<T>(args: {
  selector: string
  store: CommentStore
  ports: Ports
  change: (current: readonly DiffComment[]) => { next: DiffComment[]; outcome: T } | { outcome: T }
}): Promise<{ worktree: string; outcome: T }> {
  const worktree = await args.ports.resolveWorktree(args.selector)
  const executionHostId = executionHostOf(worktree)
  // Why: a folder workspace removed while this was resolving would otherwise get a blank row back (#22712).
  if (isRemovedFolderWorkspaceInstance(args.store, worktree.id, executionHostId)) {
    throw new Error('selector_not_found')
  }
  const changed = args.change(readStoredComments(args.store, worktree))
  if ('next' in changed) {
    if (executionHostId && args.store.setWorktreeMetaForHost) {
      args.store.setWorktreeMetaForHost(worktree.id, executionHostId, {
        diffComments: changed.next
      })
    } else {
      args.store.setWorktreeMeta(worktree.id, { diffComments: changed.next })
    }
    args.ports.invalidateResolved()
    // Why: the window applied nothing itself, so it only learns of the change from this push.
    args.ports.notifyChanged(worktree.repoId)
  }
  return { worktree: worktree.id, outcome: changed.outcome }
}

function findComment(current: readonly DiffComment[], id: string): number {
  const index = current.findIndex((comment) => comment.id === id)
  if (index === -1) {
    throw new Error(COMMENT_NOT_FOUND_CODE)
  }
  return index
}

export async function removeRuntimeWorktreeComment(args: {
  selector: string
  id: string
  store: CommentStore
  ports: Ports
}): Promise<RuntimeCommentRemoveResult> {
  const { worktree, outcome } = await changeRuntimeWorktreeComments({
    ...args,
    change: (current) => {
      const index = findComment(current, args.id)
      return {
        next: current.filter((_, position) => position !== index),
        outcome: toRuntimeCommentRecord(current[index])
      }
    }
  })
  return { worktree, removed: outcome }
}

export async function editRuntimeWorktreeComment(args: {
  selector: string
  id: string
  body: string
  store: CommentStore
  ports: Ports
}): Promise<RuntimeCommentEditResult> {
  // Why trimmed: the window's own edit trims, so a note never differs by stray whitespace.
  const body = args.body.trim()
  if (!body) {
    throw new Error('invalid_argument')
  }
  const { worktree, outcome } = await changeRuntimeWorktreeComments({
    ...args,
    change: (current) => {
      const index = findComment(current, args.id)
      const existing = current[index]
      if (existing.body === body) {
        return { outcome: { comment: toRuntimeCommentRecord(existing), changed: false } }
      }
      // Why sentAt dropped: the window does the same, so an edited note is queued for the next send.
      const { sentAt: _sentAt, ...rest } = existing
      const edited: DiffComment = { ...rest, body }
      const next = current.slice()
      next[index] = edited
      return { next, outcome: { comment: toRuntimeCommentRecord(edited), changed: true } }
    }
  })
  return { worktree, ...outcome }
}
