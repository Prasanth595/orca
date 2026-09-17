import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  activateWebRuntimeSessionTab: vi.fn(),
  focusTerminalTabSurface: vi.fn(),
  getActiveWorktreeRuntimeEnvironmentId: vi.fn<() => string | null>(() => null),
  isWebRuntimeSessionActive: vi.fn(() => false),
  setActiveBrowserTab: vi.fn(),
  setActiveTab: vi.fn(),
  setActiveTabType: vi.fn()
}))

const storeBox = vi.hoisted(
  (): {
    state: {
      terminalLayoutsByTabId: Record<string, { activeLeafId?: string | null }>
    }
  } => ({
    state: {
      terminalLayoutsByTabId: {}
    }
  })
)

vi.mock('react', () => ({
  useCallback: <T>(callback: T) => callback
}))

vi.mock('../store', () => ({
  useAppStore: {
    getState: () => storeBox.state
  }
}))

vi.mock('@/lib/focus-terminal-tab-surface', () => ({
  focusTerminalTabSurface: mocks.focusTerminalTabSurface
}))

vi.mock('@/runtime/web-runtime-session', () => ({
  activateWebRuntimeSessionTab: mocks.activateWebRuntimeSessionTab,
  isWebRuntimeSessionActive: mocks.isWebRuntimeSessionActive
}))

vi.mock('@/runtime/remote-browser-tab-ownership', () => ({
  browserWorkspaceHasRemoteOwner: vi.fn(() => false)
}))

vi.mock('./terminal-workspace-model', () => ({
  getActiveWorktreeRuntimeEnvironmentId: mocks.getActiveWorktreeRuntimeEnvironmentId
}))

import { useTerminalActivationActions } from './use-terminal-activation-actions'

function createController() {
  return {
    activeWorktreeId: 'worktree-1',
    setActiveBrowserTab: mocks.setActiveBrowserTab,
    setActiveTab: mocks.setActiveTab,
    setActiveTabType: mocks.setActiveTabType
  }
}

describe('useTerminalActivationActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storeBox.state.terminalLayoutsByTabId = {}
    mocks.getActiveWorktreeRuntimeEnvironmentId.mockReturnValue(null)
    mocks.isWebRuntimeSessionActive.mockReturnValue(false)
  })

  it('restores focus to the active split pane when a terminal tab is activated', () => {
    storeBox.state.terminalLayoutsByTabId['terminal-1'] = { activeLeafId: 'right-leaf' }
    const { handleActivateTab } = useTerminalActivationActions(createController())

    handleActivateTab('terminal-1')

    expect(mocks.setActiveTab).toHaveBeenCalledWith('terminal-1')
    expect(mocks.setActiveTabType).toHaveBeenCalledWith('terminal')
    expect(mocks.focusTerminalTabSurface).toHaveBeenCalledWith('terminal-1', 'right-leaf')
  })

  it('falls back when a terminal tab has no saved active pane', () => {
    const { handleActivateTab } = useTerminalActivationActions(createController())

    handleActivateTab('terminal-1')

    expect(mocks.focusTerminalTabSurface).toHaveBeenCalledWith('terminal-1', null)
  })

  it('keeps paired-host terminal activation intact', () => {
    mocks.getActiveWorktreeRuntimeEnvironmentId.mockReturnValue('environment-1')
    mocks.isWebRuntimeSessionActive.mockReturnValue(true)
    const { handleActivateTab } = useTerminalActivationActions(createController())

    handleActivateTab('terminal-1')

    expect(mocks.activateWebRuntimeSessionTab).toHaveBeenCalledWith({
      worktreeId: 'worktree-1',
      tabId: 'terminal-1',
      environmentId: 'environment-1'
    })
  })
})
