import { defineMethod } from '../core'
import {
  CommentEdit,
  CommentList,
  CommentRemove
} from '../../../../shared/rpc-contract/comment-params'

export const COMMENT_METHODS = [
  defineMethod({
    name: 'comment.list',
    permission: 'workspace',
    params: CommentList,
    handler: (params, { runtime }) =>
      runtime.listWorktreeComments({
        selector: params.worktree,
        ...(params.filePath !== undefined ? { filePath: params.filePath } : {}),
        ...(params.source !== undefined ? { source: params.source } : {})
      })
  }),
  defineMethod({
    name: 'comment.rm',
    permission: 'workspace',
    params: CommentRemove,
    handler: (params, { runtime }) =>
      runtime.removeWorktreeComment({ selector: params.worktree, id: params.id })
  }),
  defineMethod({
    name: 'comment.edit',
    permission: 'workspace',
    params: CommentEdit,
    handler: (params, { runtime }) =>
      runtime.editWorktreeComment({ selector: params.worktree, id: params.id, body: params.body })
  })
]
