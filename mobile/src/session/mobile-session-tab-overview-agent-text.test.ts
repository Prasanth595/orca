import { describe, expect, it } from 'vitest'
import { readWorktreeAgentText } from './mobile-session-tab-overview-agent-text'

const WORKTREE = 'repo::/work/project'

describe('readWorktreeAgentText', () => {
  it('keys this worktree’s agent rows by pane and keeps their words', () => {
    const text = readWorktreeAgentText(
      [
        {
          worktreeId: 'repo::/work/other',
          agents: [{ paneKey: 'other:leaf', lastAssistantMessage: '다른 워크트리', prompt: '' }]
        },
        {
          worktreeId: WORKTREE,
          agents: [
            {
              paneKey: 'done:leaf',
              state: 'done',
              lastAssistantMessage: '세 PR 모두 반영했습니다.',
              prompt: '반영해 줘'
            },
            { paneKey: 'asked:leaf', state: 'working', lastAssistantMessage: null, prompt: '시험' }
          ]
        }
      ],
      WORKTREE
    )
    expect([...text]).toEqual([
      ['done:leaf', { lastAssistantMessage: '세 PR 모두 반영했습니다.', prompt: '반영해 줘' }],
      ['asked:leaf', { lastAssistantMessage: null, prompt: '시험' }]
    ])
  })

  it('reads nothing for a missing worktree and skips rows it cannot key', () => {
    expect(
      readWorktreeAgentText([{ worktreeId: 'repo::/work/other', agents: [] }], WORKTREE).size
    ).toBe(0)
    const text = readWorktreeAgentText(
      [
        null,
        'row',
        {
          worktreeId: WORKTREE,
          agents: [null, { lastAssistantMessage: '키 없음' }, { paneKey: 'bare:leaf', prompt: 7 }]
        }
      ],
      WORKTREE
    )
    expect([...text]).toEqual([['bare:leaf', { lastAssistantMessage: null, prompt: '' }]])
    expect(readWorktreeAgentText([{ worktreeId: WORKTREE }], WORKTREE).size).toBe(0)
  })
})
