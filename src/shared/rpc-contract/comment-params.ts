import { z } from 'zod'
import { requiredString, OptionalString } from './rpc-param-primitives'

export const CommentList = z.object({
  worktree: requiredString('Missing worktree selector'),
  filePath: OptionalString,
  source: z.enum(['markdown', 'diff']).optional()
})

export const CommentRemove = z.object({
  worktree: requiredString('Missing worktree selector'),
  id: requiredString('Missing comment id')
})

export const CommentEdit = z.object({
  worktree: requiredString('Missing worktree selector'),
  id: requiredString('Missing comment id'),
  body: requiredString('Missing comment body').refine((body) => body.trim().length > 0, {
    message: 'Comment body cannot be empty'
  })
})
