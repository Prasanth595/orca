import type {
  RuntimeCommentEditResult,
  RuntimeCommentListResult,
  RuntimeCommentRecord,
  RuntimeCommentRemoveResult
} from '../shared/runtime-comment-contracts'

const SELECTED_TEXT_PREVIEW_LENGTH = 80

function formatCommentLocation(comment: RuntimeCommentRecord): string {
  const range =
    comment.startLine !== undefined && comment.startLine !== comment.line
      ? `${comment.startLine}-${comment.line}`
      : String(comment.line)
  return `${comment.filePath}:${range}`
}

function previewSelectedText(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > SELECTED_TEXT_PREVIEW_LENGTH
    ? `${flat.slice(0, SELECTED_TEXT_PREVIEW_LENGTH - 1)}…`
    : flat
}

export function formatCommentList(result: RuntimeCommentListResult): string {
  if (result.comments.length === 0) {
    return 'No comments.'
  }
  const blocks = result.comments.map((comment) => {
    const lines = [
      `${comment.id}  ${formatCommentLocation(comment)}  ${comment.source}${comment.sentAt === undefined ? '' : '  sent'}`
    ]
    if (comment.selectedText) {
      lines.push(`  on: ${previewSelectedText(comment.selectedText)}`)
    }
    lines.push(...comment.body.split('\n').map((line) => `  ${line}`))
    return lines.join('\n')
  })
  return blocks.join('\n\n')
}

export function formatCommentRemove(result: RuntimeCommentRemoveResult): string {
  return `Deleted comment ${result.removed.id} (${formatCommentLocation(result.removed)}).`
}

export function formatCommentEdit(result: RuntimeCommentEditResult): string {
  return result.changed
    ? `Updated comment ${result.comment.id} (${formatCommentLocation(result.comment)}).`
    : `Comment ${result.comment.id} already says that; nothing changed.`
}
