// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClaudeSessionMovePrompt } from './claude-session-move-prompt'

const onOldAccount = vi.hoisted(() => ({ count: 0 }))
const moveClaudeSessionsToSelectedAccount = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/lib/claude-session-move-coordinator', () => ({
  refreshClaudeMoveAccounts: vi.fn(async () => {}),
  listClaudeSessionsOnOtherLogin: () =>
    Array.from({ length: onOldAccount.count }, (_, index) => ({ paneKey: `pane-${index}` })),
  moveClaudeSessionsToSelectedAccount
}))

describe('ClaudeSessionMovePrompt', () => {
  beforeEach(() => {
    moveClaudeSessionsToSelectedAccount.mockClear()
  })
  afterEach(cleanup)

  it('stays out of the way while every session runs on the selected account', async () => {
    onOldAccount.count = 0
    const { container } = render(<ClaudeSessionMovePrompt />)

    expect(container.textContent).toBe('')
  })

  it('says how many sessions are still on the old account and moves them', async () => {
    onOldAccount.count = 2
    render(<ClaudeSessionMovePrompt />)

    expect(await screen.findByText('2 Claude sessions are still on the old account.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Move 2 Sessions' }))

    expect(moveClaudeSessionsToSelectedAccount).toHaveBeenCalledOnce()
  })

  it('words a single session as one', async () => {
    onOldAccount.count = 1
    render(<ClaudeSessionMovePrompt />)

    expect(await screen.findByRole('button', { name: 'Move Session' })).toBeTruthy()
  })
})
