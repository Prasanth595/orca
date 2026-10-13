import type { DiffCommentSource } from './diff-comment-types'

/** One review note (a markdown or diff comment) as the CLI and other RPC clients see it. */
export type RuntimeCommentRecord = {
  id: string
  /** Path relative to the workspace root. */
  filePath: string
  source: DiffCommentSource
  /** The line the note is anchored to; the last line when it covers a range. */
  line: number
  /** First line of a multi-line note. */
  startLine?: number
  /** Exact text selected when a markdown note was created. */
  selectedText?: string
  body: string
  createdAt: number
  updatedAt?: number
  /** Set once the note was handed to an agent; editing the note clears it. */
  sentAt?: number
}

export type RuntimeCommentListResult = {
  worktree: string
  comments: RuntimeCommentRecord[]
}

export type RuntimeCommentRemoveResult = {
  worktree: string
  removed: RuntimeCommentRecord
}

export type RuntimeCommentEditResult = {
  worktree: string
  comment: RuntimeCommentRecord
  /** False when the new text matched the saved text and nothing was written. */
  changed: boolean
}
