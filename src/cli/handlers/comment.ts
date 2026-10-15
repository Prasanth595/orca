import type {
  RuntimeCommentEditResult,
  RuntimeCommentListResult,
  RuntimeCommentRemoveResult
} from '../../shared/runtime-comment-contracts'
import { formatCommentEdit, formatCommentList, formatCommentRemove } from '../comment-format'
import type { CommandHandler, HandlerContext } from '../dispatch'
import { getOptionalStringFlag, getRequiredStringFlag } from '../flags'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import { getOptionalWorktreeSelector, resolveCurrentWorktreeSelector } from '../selectors'
import { resolveFilePath } from './file'

async function getCommentWorktreeSelector({ flags, cwd, client }: HandlerContext): Promise<string> {
  const worktree = flags.get('worktree')
  if (flags.has('worktree') && (typeof worktree !== 'string' || worktree.length === 0)) {
    throw new RuntimeClientError('invalid_argument', 'Missing value for --worktree.')
  }
  const explicit = await getOptionalWorktreeSelector(flags, 'worktree', cwd, client)
  if (explicit) {
    return explicit
  }
  if (client.isRemote) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Remote comment commands require --worktree because the client cwd cannot identify a server worktree.'
    )
  }
  return await resolveCurrentWorktreeSelector(cwd, client)
}

function getCommentSourceFlag(
  flags: Map<string, string | boolean>
): 'markdown' | 'diff' | undefined {
  const source = getOptionalStringFlag(flags, 'source')
  if (source === undefined || source === 'markdown' || source === 'diff') {
    return source
  }
  throw new RuntimeClientError('invalid_argument', 'Invalid --source. Use markdown or diff.')
}

// Why: an older Orca app has no comment methods; say so instead of surfacing method_not_found.
async function callCommentMethod<TResult>(
  ctx: HandlerContext,
  method: string,
  params: Record<string, unknown>,
  commentId?: string
) {
  try {
    return await ctx.client.call<TResult>(method, params)
  } catch (error) {
    if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
      throw new RuntimeClientError(
        'incompatible_runtime',
        'This Orca app does not support comment commands yet. Update Orca and try again.'
      )
    }
    if (error instanceof RuntimeClientError && error.code === 'comment_not_found') {
      throw new RuntimeClientError(
        'comment_not_found',
        `No comment with id ${commentId ?? ''} in this worktree. Run \`orca comment list\` to see the ids.`
      )
    }
    throw error
  }
}

export const COMMENT_HANDLERS: Record<string, CommandHandler> = {
  'comment list': async (ctx) => {
    const worktree = await getCommentWorktreeSelector(ctx)
    const source = getCommentSourceFlag(ctx.flags)
    const file = getOptionalStringFlag(ctx.flags, 'file')
    const filePath = file === undefined ? undefined : await resolveFilePath(ctx, worktree, file)
    const result = await callCommentMethod<RuntimeCommentListResult>(ctx, 'comment.list', {
      worktree,
      ...(filePath !== undefined ? { filePath } : {}),
      ...(source !== undefined ? { source } : {})
    })
    printResult(result, ctx.json, formatCommentList)
  },
  'comment rm': async (ctx) => {
    const id = getRequiredStringFlag(ctx.flags, 'id')
    const worktree = await getCommentWorktreeSelector(ctx)
    const result = await callCommentMethod<RuntimeCommentRemoveResult>(
      ctx,
      'comment.rm',
      { worktree, id },
      id
    )
    printResult(result, ctx.json, formatCommentRemove)
  },
  'comment edit': async (ctx) => {
    const id = getRequiredStringFlag(ctx.flags, 'id')
    const body = getRequiredStringFlag(ctx.flags, 'body')
    if (body.trim().length === 0) {
      throw new RuntimeClientError('invalid_argument', '--body cannot be empty.')
    }
    const worktree = await getCommentWorktreeSelector(ctx)
    const result = await callCommentMethod<RuntimeCommentEditResult>(
      ctx,
      'comment.edit',
      { worktree, id, body },
      id
    )
    printResult(result, ctx.json, formatCommentEdit)
  }
}
