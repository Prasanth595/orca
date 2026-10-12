import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import type { AppState } from '../../store/types'

const mocks = vi.hoisted(() => ({
  revealFloatingWorkspacePanel: vi.fn()
}))

vi.mock('@/lib/floating-workspace-panel-reveal', () => ({
  revealFloatingWorkspacePanel: mocks.revealFloatingWorkspacePanel
}))

import { activateTerminalInitiatedWorktree } from './terminal-command-state'

/** A store stub with only the members activateTerminalInitiatedWorktree reads. */
function createStore() {
  const store = {
    isNavigatingHistory: false,
    setActiveView: vi.fn(),
    setActiveWorktree: vi.fn(),
    markWorktreeVisited: vi.fn(),
    recordWorktreeVisit: vi.fn()
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: activateTerminalInitiatedWorktree reads only the members stubbed above.
  return { store, appState: store as unknown as AppState }
}

describe('activateTerminalInitiatedWorktree', () => {
  beforeEach(() => {
    mocks.revealFloatingWorkspacePanel.mockReset()
  })

  it('reveals the floating panel instead of making the floating workspace the main selection', () => {
    const { store, appState } = createStore()

    activateTerminalInitiatedWorktree(appState, FLOATING_TERMINAL_WORKTREE_ID)

    expect(mocks.revealFloatingWorkspacePanel).toHaveBeenCalledWith(appState)
    expect(store.setActiveWorktree).not.toHaveBeenCalled()
    expect(store.setActiveView).not.toHaveBeenCalled()
    expect(store.markWorktreeVisited).not.toHaveBeenCalled()
    expect(store.recordWorktreeVisit).not.toHaveBeenCalled()
  })

  it('reveals the floating panel for a tab just created there', () => {
    const { store, appState } = createStore()

    activateTerminalInitiatedWorktree(appState, FLOATING_TERMINAL_WORKTREE_ID, ['tab-new'])

    expect(mocks.revealFloatingWorkspacePanel).toHaveBeenCalledTimes(1)
    expect(store.setActiveWorktree).not.toHaveBeenCalled()
  })

  it('still activates an ordinary workspace in the main window', () => {
    const { store, appState } = createStore()

    activateTerminalInitiatedWorktree(appState, 'repo::/work/feature')

    expect(mocks.revealFloatingWorkspacePanel).not.toHaveBeenCalled()
    expect(store.setActiveView).toHaveBeenCalledWith('terminal')
    expect(store.setActiveWorktree).toHaveBeenCalledWith('repo::/work/feature')
    expect(store.markWorktreeVisited).toHaveBeenCalledWith('repo::/work/feature')
    expect(store.recordWorktreeVisit).toHaveBeenCalledWith('repo::/work/feature')
  })
})
