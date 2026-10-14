import { useCallback, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { toast } from 'sonner'
import { getCommentBodySubmitState } from '@/lib/comment-body-submit-state'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { jiraAddIssueCommentForTarget } from '@/runtime/runtime-jira-client'
import { translate } from '@/i18n/i18n'
import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'
import type { JiraComment, JiraIssue } from '../../../shared/jira-types'

export function useJiraIssueCommentSubmission({
  displayed,
  owner,
  requestIdRef,
  optimisticCommentsRef,
  setComments
}: {
  displayed: JiraIssue | null
  owner: RuntimeClientTarget
  requestIdRef: RefObject<number>
  optimisticCommentsRef: RefObject<JiraComment[]>
  setComments: Dispatch<SetStateAction<JiraComment[]>>
}) {
  const [commentDraft, setCommentDraft] = useState('')
  const [commentSubmitting, setCommentSubmitting] = useState(false)

  const handleSubmitComment = useCallback(async (): Promise<void> => {
    if (!displayed || commentSubmitting) {
      return
    }
    const bodyState = getCommentBodySubmitState(commentDraft)
    if (bodyState.status === 'empty') {
      return
    }
    if (bodyState.status === 'too-large-leading-whitespace') {
      toast.error(
        translate(
          'auto.components.JiraIssueWorkspace.commentTooLarge',
          'Comment is too large to submit safely.'
        )
      )
      return
    }
    setCommentSubmitting(true)
    const requestId = requestIdRef.current
    try {
      const result = await jiraAddIssueCommentForTarget(
        owner,
        displayed.key,
        bodyState.body,
        displayed.siteId
      )
      if (!result.ok) {
        throw new Error(result.error)
      }
      if (requestId !== requestIdRef.current) {
        return
      }
      const comment: JiraComment = {
        id: result.id || createBrowserUuid(),
        body: bodyState.body,
        createdAt: new Date().toISOString(),
        user: { accountId: 'local', displayName: 'You' }
      }
      optimisticCommentsRef.current.push(comment)
      setComments((prev) => [...prev, comment])
      setCommentDraft('')
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : translate('auto.components.JiraIssueWorkspace.fa132c8aed', 'Failed to add comment.')
      )
    } finally {
      if (requestId === requestIdRef.current) {
        setCommentSubmitting(false)
      }
    }
  }, [
    commentDraft,
    commentSubmitting,
    displayed,
    owner,
    optimisticCommentsRef,
    requestIdRef,
    setComments
  ])

  return {
    commentDraft,
    setCommentDraft,
    commentSubmitting,
    setCommentSubmitting,
    handleSubmitComment
  }
}
