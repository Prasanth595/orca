// @vitest-environment happy-dom

import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useChecksPanelCommentResolution } from './use-checks-panel-comment-resolution'

afterEach(cleanup)

const NO_AGENT_REASON =
  'No AI agent is both installed and shown in Settings. Install one, or show one in Settings.'

describe('useChecksPanelCommentResolution', () => {
  it('keeps only the action with a saved hidden agent usable when every agent is hidden', () => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the fixture supplies every field the hook reads; handlers are never called.
    const model = {
      activeGitLabReview: null,
      activeReview: { provider: 'github', number: 42 },
      activeWorktree: null,
      activeWorktreeId: 'wt-1',
      branch: 'feature',
      claimedCommentResolutionRef: { current: null },
      commentResolutionAckBusy: false,
      commentResolutionLaunchAcceptedRef: { current: false },
      commentsLoading: false,
      detectedAgentIds: ['claude', 'codex'],
      isCurrentAsyncResult: () => true,
      pendingCommentResolutionRef: { current: null },
      pr: null,
      prCacheKey: 'pr-42',
      prNumber: 42,
      repo: {
        id: 'repo-1',
        path: '/repo',
        sourceControlAi: { actionOverrides: { fixChecks: { agentId: 'codex' } } }
      },
      resolveReviewThread: async () => true,
      setAgentComposerState: () => {},
      setComments: () => {},
      settings: { defaultTuiAgent: null, disabledTuiAgents: ['claude', 'codex'] },
      sourceControlAiActionsVisible: true
    } as unknown as Parameters<typeof useChecksPanelCommentResolution>[0]

    const { result } = renderHook(() => useChecksPanelCommentResolution(model))

    expect(result.current.fixChecksDisabledReason).toBeUndefined()
    expect(result.current.resolveConflictsDisabledReason).toBe(NO_AGENT_REASON)
    expect(result.current.resolveCommentsWithAIDisabledReason).toBe(NO_AGENT_REASON)
  })
})
