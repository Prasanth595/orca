import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../store'
import { registerWorkspaceShortcutIpcBridge } from './workspace-shortcut-ipc-bridge'

const initialState = useAppStore.getInitialState()
const uiSet = vi.fn(() => Promise.resolve())
const unsubscribe = (): void => {}
let toggleStatusBarFromMenu: () => void = () => {}

beforeEach(() => {
  useAppStore.setState(initialState, true)
  uiSet.mockClear()
  const subscribe = (): (() => void) => unsubscribe
  vi.stubGlobal('window', {
    api: {
      ui: {
        set: uiSet,
        onOpenQuickOpen: subscribe,
        onToggleQuickCommandsMenu: subscribe,
        onOpenNewWorkspace: subscribe,
        onOpenTasks: subscribe,
        onJumpToWorktreeIndex: subscribe,
        onJumpToTabIndex: subscribe,
        onWorktreeHistoryNavigate: subscribe,
        onToggleStatusBar: (handler: () => void) => {
          toggleStatusBarFromMenu = handler
          return unsubscribe
        }
      }
    }
  })
  registerWorkspaceShortcutIpcBridge([])
})

afterEach(() => {
  useAppStore.setState(initialState, true)
  vi.unstubAllGlobals()
})

describe('View → Appearance → Show Status Bar', () => {
  it('ends terminal fullscreen, then toggles the saved setting', () => {
    useAppStore.setState({ statusBarVisible: true })
    useAppStore.getState().enterTerminalFullscreen({
      worktreeId: 'wt-1',
      tabId: 'tab-1',
      leafId: 'leaf-1',
      expandedPane: false
    })
    const writes: string[] = []
    const stopWatching = useAppStore.subscribe((state, previous) => {
      if (previous.terminalFullscreen && !state.terminalFullscreen) {
        writes.push('exit fullscreen')
      }
      if (previous.statusBarVisible !== state.statusBarVisible) {
        writes.push(`statusBarVisible=${state.statusBarVisible}`)
      }
    })

    toggleStatusBarFromMenu()
    stopWatching()

    expect(writes).toEqual(['exit fullscreen', 'statusBarVisible=false'])
    expect(uiSet).toHaveBeenCalledWith({ statusBarVisible: false })
  })

  it('toggles the saved setting as before when no terminal is fullscreen', () => {
    useAppStore.setState({ statusBarVisible: false })

    toggleStatusBarFromMenu()

    expect(useAppStore.getState().statusBarVisible).toBe(true)
    expect(uiSet).toHaveBeenCalledWith({ statusBarVisible: true })
  })
})
