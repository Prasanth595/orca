import { describe, expect, it } from 'vitest'
import { AGENT_STATUS_STALE_AFTER_MS } from '../worktree/agent-row-display'
import type { MobileSessionTabOverviewAgentText } from './mobile-session-tab-overview-agent-text'
import { buildMobileSessionTabOverviewRows } from './mobile-session-tab-overview-rows'
import type { MarkdownDocState, MobileSessionTab } from './mobile-session-route-types'

const NOW = 10_000_000

function terminal(id: string, title: string, extra: Partial<MobileSessionTab> = {}) {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: terminal fixtures carry only the fields the row builder reads.
  return {
    type: 'terminal',
    id,
    title,
    terminal: `pty-${id}`,
    isActive: false,
    ...extra
  } as MobileSessionTab
}

function agentStatus(
  state: 'working' | 'blocked' | 'waiting' | 'done',
  updatedAt = NOW,
  extra: Record<string, unknown> = {}
) {
  return { state, prompt: '', updatedAt, stateStartedAt: updatedAt, ...extra }
}

function build(
  tabs: MobileSessionTab[],
  options: {
    titles?: Map<string, string>
    activeTabId?: string | null
    markdownDocs?: Map<string, MarkdownDocState>
    agentText?: Map<string, MobileSessionTabOverviewAgentText>
  } = {}
) {
  return buildMobileSessionTabOverviewRows({
    tabs,
    titles: options.titles ?? new Map(),
    activeTabId: options.activeTabId ?? null,
    markdownDocs: options.markdownDocs ?? new Map(),
    agentText: options.agentText ?? new Map(),
    now: NOW
  })
}

describe('buildMobileSessionTabOverviewRows', () => {
  it('keeps strip order, prefers the strip title and marks only the active tab', () => {
    const rows = build([terminal('a', 'zsh'), terminal('b', 'node'), terminal('c', 'vim')], {
      titles: new Map([['b', '탭 펼침 목록 구현과 시험 정리']]),
      activeTabId: 'b'
    })
    expect(rows.map((row) => [row.tab.id, row.title, row.active])).toEqual([
      ['a', 'zsh', false],
      ['b', '탭 펼침 목록 구현과 시험 정리', true],
      ['c', 'vim', false]
    ])
  })

  it('shows the agent state of a terminal that reports one and none for a plain shell', () => {
    const rows = build([
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the builder reads only the state clock fields.
      terminal('working', 'Claude', {
        agentStatus: agentStatus('working')
      } as Partial<MobileSessionTab>),
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the builder reads only the state clock fields.
      terminal('waiting', 'Codex', {
        agentStatus: agentStatus('waiting')
      } as Partial<MobileSessionTab>),
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the builder reads only the state clock fields.
      terminal('done', 'Claude', { agentStatus: agentStatus('done') } as Partial<MobileSessionTab>),
      terminal('shell', 'zsh')
    ])
    expect(rows.map((row) => row.agent?.state ?? null)).toEqual([
      'working',
      'waiting',
      'done',
      null
    ])
  })

  it('reads a long-silent working agent as idle, as the worktree list does', () => {
    const stale = NOW - AGENT_STATUS_STALE_AFTER_MS - 1
    const rows = build([
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the builder reads only the state clock fields.
      terminal('a', 'Claude', {
        agentStatus: agentStatus('working', stale)
      } as Partial<MobileSessionTab>)
    ])
    expect(rows[0].agent?.state).toBe('idle')
  })

  it('names the state and how long the agent has held it, the worktree list way', () => {
    const rows = build([
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the builder reads only the state clock fields.
      terminal('waiting', 'Codex', {
        agentStatus: agentStatus('waiting', NOW, { stateStartedAt: NOW - 2 * 60 * 60_000 })
      } as Partial<MobileSessionTab>),
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the builder reads only the state clock fields.
      terminal('done', 'Claude', {
        agentStatus: agentStatus('done', NOW, { stateStartedAt: NOW - 5 * 60_000 })
      } as Partial<MobileSessionTab>),
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the builder reads only the state clock fields.
      terminal('stopping', 'Claude', {
        agentStatus: agentStatus('working', NOW, {
          mainAgent: { state: 'working', stopping: true, stateStartedAt: NOW }
        })
      } as Partial<MobileSessionTab>),
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the builder reads only the state clock fields.
      terminal('undated', 'Claude', {
        agentStatus: agentStatus('working', NOW, { stateStartedAt: 0 })
      } as Partial<MobileSessionTab>)
    ])
    expect(rows.map((row) => row.agent)).toEqual([
      { state: 'waiting', label: 'Waiting for input', since: '2h' },
      { state: 'done', label: 'Done', since: '5m' },
      { state: 'working', label: 'Stopping…', since: 'just now' },
      { state: 'working', label: 'Working', since: null }
    ])
  })

  it('shows the agent’s last words, else its prompt, folded onto one line', () => {
    const rows = build([
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the builder reads only the status text fields.
      terminal('reply', 'Claude', {
        agentStatus: agentStatus('done', NOW, {
          prompt: '리뷰해 줘',
          lastAssistantMessage:
            '리뷰 전 점검을\n\n  통과했습니다.\n::orca-visual{file="usage.html" title="Usage"}'
        })
      } as Partial<MobileSessionTab>),
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the builder reads only the status text fields.
      terminal('prompt', 'Codex', {
        agentStatus: agentStatus('working', NOW, { prompt: '  빌드 24를\n올려 줘 ' })
      } as Partial<MobileSessionTab>),
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the builder reads only the status text fields.
      terminal('silent', 'Claude', {
        agentStatus: agentStatus('working', NOW, { lastAssistantMessage: '  ' })
      } as Partial<MobileSessionTab>),
      terminal('shell', 'zsh')
    ])
    expect(rows.map((row) => row.detail)).toEqual([
      '리뷰 전 점검을 통과했습니다.',
      '빌드 24를 올려 줘',
      null,
      null
    ])
  })

  it('lets the worktree list speak for a finished tab whose title-built status has no words', () => {
    // Shaped like the host's title-only status for an ended turn: a pane, a state, no words.
    const titleOnly = (paneKey: string, extra: Record<string, unknown> = {}) =>
      agentStatus('done', NOW, { paneKey, ...extra })
    const rows = build(
      [
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the builder reads only the status text fields.
        terminal('done', 'Claude', {
          agentStatus: titleOnly('tab-done:leaf')
        } as Partial<MobileSessionTab>),
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the builder reads only the status text fields.
        terminal('asked', 'Claude', {
          agentStatus: titleOnly('tab-asked:leaf')
        } as Partial<MobileSessionTab>),
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the builder reads only the status text fields.
        terminal('own', 'Claude', {
          agentStatus: titleOnly('tab-own:leaf', { lastAssistantMessage: '탭이 직접 들고 온 답' })
        } as Partial<MobileSessionTab>),
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the builder reads only the status text fields.
        terminal('unlisted', 'Claude', {
          agentStatus: titleOnly('tab-unlisted:leaf')
        } as Partial<MobileSessionTab>),
        terminal('shell', 'zsh')
      ],
      {
        agentText: new Map([
          [
            'tab-done:leaf',
            {
              lastAssistantMessage:
                '세 PR 모두\n  반영했습니다.\n::orca-visual{file="usage.html" title="Usage"}',
              prompt: '반영해 줘'
            }
          ],
          ['tab-asked:leaf', { lastAssistantMessage: null, prompt: '빌드 31을\n올려 줘' }],
          ['tab-own:leaf', { lastAssistantMessage: '목록의 옛 답', prompt: '' }]
        ])
      }
    )
    expect(rows.map((row) => row.detail)).toEqual([
      '세 PR 모두 반영했습니다.',
      '빌드 31을 올려 줘',
      '탭이 직접 들고 온 답',
      null,
      null
    ])
  })

  it('shows where a file or page lives when its title alone does not say', () => {
    const rows = build([
      {
        type: 'file',
        id: 'nested',
        title: 'a.ts',
        filePath: '/repo/src/a.ts',
        relativePath: 'src/a.ts',
        isDirty: false,
        isActive: false
      },
      {
        type: 'file',
        id: 'root',
        title: 'b.ts',
        filePath: '/repo/b.ts',
        relativePath: 'b.ts',
        isDirty: false,
        isActive: false
      },
      {
        type: 'browser',
        id: 'page',
        title: 'Orca',
        browserWorkspaceId: 'bw',
        browserPageId: null,
        url: 'https://example.com/orca',
        loading: false,
        canGoBack: false,
        canGoForward: false,
        isActive: false
      }
    ])
    expect(rows.map((row) => row.detail)).toEqual(['src/a.ts', null, 'https://example.com/orca'])
  })

  it('flags unsaved Markdown drafts and dirty files so the row keeps Close in the menu', () => {
    const markdown = (id: string, isDirty: boolean): MobileSessionTab => ({
      type: 'markdown',
      id,
      title: `${id}.md`,
      filePath: `/repo/${id}.md`,
      relativePath: `${id}.md`,
      isDirty,
      isActive: false,
      documentVersion: '1'
    })
    const rows = build(
      [
        markdown('clean', false),
        markdown('draft', false),
        markdown('host-dirty', true),
        {
          type: 'file',
          id: 'file',
          title: 'a.ts',
          filePath: '/repo/a.ts',
          relativePath: 'a.ts',
          isDirty: true,
          isActive: false
        },
        terminal('shell', 'zsh')
      ],
      {
        markdownDocs: new Map<string, MarkdownDocState>([
          [
            'draft',
            {
              status: 'ready',
              content: 'a',
              localContent: 'ab',
              baseVersion: '1',
              isDirty: true,
              editable: true
            }
          ]
        ])
      }
    )
    expect(rows.map((row) => [row.tab.id, row.hasUnsavedEdits])).toEqual([
      ['clean', false],
      ['draft', true],
      ['host-dirty', true],
      ['file', true],
      ['shell', false]
    ])
  })
})
