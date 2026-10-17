import {
  randomUUID,
  LINEAR_WRITE_BODY_CAP,
  addLinearIssueCommentForAgent,
  createLinearIssueAttachment,
  deleteLinearIssueCommentForAgent,
  getLinearCommentByUuidForAgent,
  getLinearStatus,
  isLinearUuid,
  updateLinearIssueCommentForAgent,
  LinearWriteFailure,
  linearError
} from './runtime-linear-command-dependencies'
import type {
  LinearAgentAccessError,
  LinearCurrentIssueContextHints,
  LinearAttachResult,
  LinearCommentAddResult,
  LinearCommentDeleteResult,
  LinearCommentEditResult
} from './runtime-linear-command-dependencies'
import { RuntimeLinearCreateCommands } from './runtime-linear-create-commands'

export class RuntimeLinearCommentCommands extends RuntimeLinearCreateCommands {
  async linearIssueAddComment(params: {
    input?: string
    current?: boolean
    workspaceId?: string
    body: string
    replyTo?: string
    writeId?: string
    context?: LinearCurrentIssueContextHints
  }): Promise<LinearCommentAddResult> {
    if (params.body.length > LINEAR_WRITE_BODY_CAP) {
      throw linearError('linear_body_too_large', 'Linear comment body is too large.')
    }
    const target = await this.resolveLinearAgentWriteTarget(params)
    const parentId = params.replyTo
      ? await this.resolveLinearCommentParentId(target.issue.id, params.replyTo, target.workspaceId)
      : null
    const writeId = params.writeId ?? randomUUID()
    const existing =
      params.writeId !== undefined
        ? await this.getMatchingLinearCommentWrite(
            writeId,
            target.issue.id,
            parentId,
            target.workspaceId,
            true
          )
        : null
    if (existing) {
      await this.notifyLinearLinkedIssueUpdated(target.workspaceId, target.issue.identifier)
      return this.linearCommentResult(existing, target, params.body.length, writeId, true)
    }

    try {
      const comment = await this.runLinearAgentWrite(
        (signal) =>
          addLinearIssueCommentForAgent(target.issue.id, params.body, target.workspaceId, {
            id: writeId,
            parentId,
            signal
          }),
        (cause) =>
          this.linearCreateStyleUnconfirmed('comment', writeId, target, {
            parentId,
            bodyRequired: true,
            cause
          })
      )
      await this.notifyLinearLinkedIssueUpdated(target.workspaceId, target.issue.identifier)
      return this.linearCommentResult(comment, target, params.body.length, writeId, false)
    } catch (error) {
      if (error instanceof LinearWriteFailure && error.kind === 'duplicate_id') {
        const comment = await this.refetchLinearCommentAfterDuplicate(
          writeId,
          target.issue.id,
          parentId,
          target.workspaceId,
          () =>
            this.linearCreateStyleUnconfirmed('comment', writeId, target, {
              parentId,
              bodyRequired: true
            })
        )
        await this.notifyLinearLinkedIssueUpdated(target.workspaceId, target.issue.identifier)
        return this.linearCommentResult(comment, target, params.body.length, writeId, true)
      }
      throw error
    }
  }

  async linearIssueAttachLink(params: {
    input?: string
    current?: boolean
    workspaceId?: string
    url: string
    title?: string
    writeId?: string
    context?: LinearCurrentIssueContextHints
  }): Promise<LinearAttachResult> {
    const url = this.parseLinearAttachmentUrl(params.url)
    const target = await this.resolveLinearAgentWriteTarget(params)
    const writeId = params.writeId ?? randomUUID()
    const title = params.title?.trim() || this.defaultLinearAttachmentTitle(url)
    const existing =
      params.writeId !== undefined
        ? await this.getMatchingLinearAttachmentWrite(
            writeId,
            target.issue.id,
            target.workspaceId,
            true
          )
        : null
    if (existing) {
      await this.notifyLinearLinkedIssueUpdated(target.workspaceId, target.issue.identifier)
      return this.linearAttachResult(existing, target, writeId, true)
    }
    try {
      const attachment = await this.runLinearAgentWrite(
        (signal) =>
          createLinearIssueAttachment(
            target.issue.id,
            { id: writeId, title, url: url.toString() },
            target.workspaceId,
            { signal }
          ),
        (cause) =>
          this.linearCreateStyleUnconfirmed('attach', writeId, target, {
            title,
            url: url.toString(),
            cause
          })
      )
      await this.notifyLinearLinkedIssueUpdated(target.workspaceId, target.issue.identifier)
      return this.linearAttachResult(attachment, target, writeId, false)
    } catch (error) {
      if (error instanceof LinearWriteFailure && error.kind === 'duplicate_id') {
        const attachment = await this.refetchLinearAttachmentAfterDuplicate(
          writeId,
          target.issue.id,
          target.workspaceId,
          () =>
            this.linearCreateStyleUnconfirmed('attach', writeId, target, {
              title,
              url: url.toString()
            })
        )
        await this.notifyLinearLinkedIssueUpdated(target.workspaceId, target.issue.identifier)
        return this.linearAttachResult(attachment, target, writeId, true)
      }
      throw error
    }
  }

  async linearCommentEdit(params: {
    commentId: string
    body: string
    workspaceId?: string
  }): Promise<LinearCommentEditResult> {
    if (params.body.length > LINEAR_WRITE_BODY_CAP) {
      throw linearError('linear_body_too_large', 'Linear comment body is too large.')
    }
    const { comment, workspaceId } = await this.resolveLinearAgentComment(params)
    const edited = await this.runLinearAgentWrite(
      (signal) =>
        updateLinearIssueCommentForAgent(comment.id, params.body, workspaceId, { signal }),
      (cause) => this.linearCommentChangeUnconfirmed('edit', comment, workspaceId, cause)
    )
    await this.notifyLinearLinkedIssueUpdated(workspaceId, comment.issue.identifier)
    return {
      comment: { id: edited.id, url: edited.url, parentId: edited.parentId },
      issue: this.linearWriteIssueRef(comment.issue),
      meta: { workspaceId, bodyChars: params.body.length }
    }
  }

  async linearCommentDelete(params: {
    commentId: string
    workspaceId?: string
  }): Promise<LinearCommentDeleteResult> {
    const { comment, workspaceId } = await this.resolveLinearAgentComment(params)
    await this.runLinearAgentWrite(
      (signal) => deleteLinearIssueCommentForAgent(comment.id, workspaceId, { signal }),
      (cause) => this.linearCommentChangeUnconfirmed('delete', comment, workspaceId, cause)
    )
    await this.notifyLinearLinkedIssueUpdated(workspaceId, comment.issue.identifier)
    return {
      comment: { id: comment.id, parentId: comment.parentId },
      issue: this.linearWriteIssueRef(comment.issue),
      meta: { workspaceId }
    }
  }

  // Why: a comment UUID lives in one workspace, so probing each connected one finds its owner.
  public async resolveLinearAgentComment(params: {
    commentId: string
    workspaceId?: string
  }): Promise<{ comment: LinearAgentComment; workspaceId: string }> {
    if (!isLinearUuid(params.commentId)) {
      throw this.linearCommentNotFound(params.commentId)
    }
    const workspaceIds = params.workspaceId
      ? [params.workspaceId]
      : (getLinearStatus().workspaces ?? []).map((workspace) => workspace.id)
    const lookups = await Promise.allSettled(
      workspaceIds.map((workspaceId) =>
        getLinearCommentByUuidForAgent(params.commentId, workspaceId)
      )
    )
    let failure: unknown
    for (const [index, lookup] of lookups.entries()) {
      if (lookup.status === 'fulfilled' && lookup.value) {
        return { comment: lookup.value, workspaceId: workspaceIds[index] }
      }
      if (lookup.status === 'rejected') {
        failure ??= lookup.reason
      }
    }
    if (failure !== undefined) {
      throw this.mapLinearReadFailure(failure)
    }
    throw this.linearCommentNotFound(params.commentId)
  }

  public linearCommentNotFound(commentId: string): LinearAgentAccessError {
    return linearError(
      'linear_comment_not_found',
      `No Linear issue comment ${commentId} was found.`,
      {
        nextSteps: [
          'Run `orca linear issue <id> --comments --json` and pass a comment `id` from it.'
        ]
      }
    )
  }

  public linearCommentChangeUnconfirmed(
    verb: 'edit' | 'delete',
    comment: LinearAgentComment,
    workspaceId: string,
    cause?: string
  ): LinearAgentAccessError {
    const issue = comment.issue.identifier
    const readBack = `orca linear issue ${issue} --comments --workspace ${workspaceId} --json`
    return linearError(
      'linear_write_unconfirmed',
      `Linear may have applied the comment ${verb}, but Orca could not confirm it.`,
      {
        workspaceId,
        issueIdentifier: comment.issue.identifier,
        nextSteps: [
          `Run \`${readBack}\` and rerun the ${verb} only if comment ${comment.id} ${
            verb === 'edit' ? 'still has its old body' : 'is still listed'
          }.`
        ],
        ...(cause ? { cause } : {})
      }
    )
  }
}

type LinearAgentComment = NonNullable<Awaited<ReturnType<typeof getLinearCommentByUuidForAgent>>>
