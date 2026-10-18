import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const boundary = vi.hoisted(
  (): {
    cached: unknown[] | null
    replies: { resolve: (reply: unknown) => void; reject: (error: unknown) => void }[]
    requests: unknown[][]
  } => ({
    cached: null,
    replies: [],
    requests: []
  })
)

vi.mock('../cache/worktree-cache', () => ({
  getCachedWorktrees: () => boundary.cached
}))
vi.mock('../worktree/worktree-catalog-snapshot-client', () => ({ WORKTREE_PS_FULL_LIMIT: 10_000 }))
vi.mock('../worktree/worktree-catalog-operations', () => ({
  worktreeCatalogRead: {
    requestSingleFlight: (...args: unknown[]) => {
      boundary.requests.push(args)
      return new Promise((resolve, reject) => boundary.replies.push({ resolve, reject }))
    },
    interpret: (reply: { ok: boolean; result?: { worktrees?: unknown[] } }) =>
      reply.ok ? { accepted: true, value: reply.result ?? {} } : { accepted: false }
  }
}))

import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import type { MobileSessionTabOverviewAgentText } from './mobile-session-tab-overview-agent-text'
import { useMobileSessionTabOverviewAgentText } from './use-mobile-session-tab-overview-agent-text'

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the hook only hands the client to the mocked read.
const CLIENT = { id: 'client' } as unknown as RpcClient
const WORKTREE = 'repo::/work/project'

const catalog = (message: string) => ({
  ok: true,
  result: {
    worktrees: [
      {
        worktreeId: WORKTREE,
        agents: [{ paneKey: 'done:leaf', lastAssistantMessage: message, prompt: '' }]
      }
    ]
  }
})

type Props = {
  open: boolean
  agentStateKey?: string
  worktreeId?: string
  connState?: ConnectionState
}

describe('useMobileSessionTabOverviewAgentText', () => {
  let renderer: ReactTestRenderer | null = null
  let seen: ReadonlyMap<string, MobileSessionTabOverviewAgentText> = new Map()

  beforeEach(() => {
    boundary.cached = null
    boundary.replies.length = 0
    boundary.requests.length = 0
    renderer = null
  })

  function Harness(props: Props): null {
    seen = useMobileSessionTabOverviewAgentText({
      client: CLIENT,
      connState: props.connState ?? 'connected',
      hostId: 'host',
      worktreeId: props.worktreeId ?? WORKTREE,
      open: props.open,
      agentStateKey: props.agentStateKey ?? 'done:leaf:done:1'
    })
    return null
  }

  function render(props: Props): void {
    act(() => {
      const element = createElement(Harness, props)
      if (renderer) {
        renderer.update(element)
      } else {
        renderer = create(element)
      }
    })
  }

  async function answer(index: number, reply: unknown): Promise<void> {
    await act(async () => {
      boundary.replies[index].resolve(reply)
    })
  }

  it('asks only while the list is open and connected, and keys the words by pane', async () => {
    render({ open: false })
    render({ open: true, connState: 'connecting' })
    expect(boundary.requests).toHaveLength(0)

    render({ open: true })
    expect(boundary.requests).toEqual([[CLIENT, 'host', { limit: 10_000 }]])
    await answer(0, catalog('세 PR 모두 반영했습니다.'))
    expect(seen.get('done:leaf')).toEqual({
      lastAssistantMessage: '세 PR 모두 반영했습니다.',
      prompt: ''
    })
    act(() => renderer?.unmount())
  })

  it('asks again when a tab changes state while open, and keeps the words between opens', async () => {
    render({ open: true })
    await answer(0, catalog('첫 답'))
    render({ open: true, agentStateKey: 'done:leaf:working:2' })
    expect(boundary.requests).toHaveLength(2)
    await answer(1, catalog('끝난 뒤 답'))
    expect(seen.get('done:leaf')?.lastAssistantMessage).toBe('끝난 뒤 답')

    // Folding asks nothing; reopening shows the last words at once while the next read runs.
    render({ open: false, agentStateKey: 'done:leaf:working:2' })
    render({ open: true, agentStateKey: 'done:leaf:working:2' })
    expect(boundary.requests).toHaveLength(3)
    expect(seen.get('done:leaf')?.lastAssistantMessage).toBe('끝난 뒤 답')
    act(() => renderer?.unmount())
  })

  it('answers the first open from the host screen’s recent list', () => {
    boundary.cached = catalog('목록에 있던 답').result.worktrees
    render({ open: true })
    expect(seen.get('done:leaf')?.lastAssistantMessage).toBe('목록에 있던 답')
    act(() => renderer?.unmount())
  })

  it('keeps what it has on a refused or failed read and never shows another route’s words', async () => {
    render({ open: true })
    await answer(0, catalog('첫 답'))
    render({ open: true, agentStateKey: 'next' })
    await answer(1, { ok: false })
    expect(seen.get('done:leaf')?.lastAssistantMessage).toBe('첫 답')
    render({ open: true, agentStateKey: 'after' })
    await act(async () => {
      boundary.replies[2].reject(new Error('socket closed'))
    })
    expect(seen.get('done:leaf')?.lastAssistantMessage).toBe('첫 답')

    render({ open: true, agentStateKey: 'after', worktreeId: 'repo::/work/other' })
    expect(seen.size).toBe(0)
    act(() => renderer?.unmount())
  })

  it('drops a reply that lands after the list folded', async () => {
    render({ open: true })
    render({ open: false })
    await answer(0, catalog('늦은 답'))
    expect(seen.size).toBe(0)
    act(() => renderer?.unmount())
  })
})
