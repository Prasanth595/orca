import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from './index'
import type { AppState } from './types'
import type { TerminalFullscreenTarget } from './slices/ui'
import { capturePersistedUIWriteBaseline } from './slices/persisted-ui-write-baseline'
import { createUIStore, makePersistedUI } from './slices/ui-slice-test-harness'
import {
  selectLeftSidebarShown,
  selectRightSidebarShown,
  selectStatusBarShown
} from './terminal-fullscreen-chrome'

const initialState = useAppStore.getInitialState()
const target: TerminalFullscreenTarget = {
  worktreeId: 'wt-1',
  tabId: 'tab-1',
  leafId: 'leaf-1',
  expandedPane: false
}
const uiSet = vi.fn(() => Promise.resolve())

function shownChrome(state: AppState): boolean[] {
  return [
    selectLeftSidebarShown(state),
    selectRightSidebarShown(state),
    selectStatusBarShown(state)
  ]
}

function enterFullscreen(saved: { sidebarOpen: boolean; rightSidebarOpen: boolean }): void {
  useAppStore.setState({ ...saved, statusBarVisible: true })
  useAppStore.getState().enterTerminalFullscreen(target)
}

beforeEach(() => {
  useAppStore.setState(initialState, true)
  uiSet.mockClear()
  vi.stubGlobal('window', { api: { ui: { set: uiSet } } })
})

afterEach(() => {
  useAppStore.setState(initialState, true)
  vi.unstubAllGlobals()
})

describe('terminal fullscreen chrome', () => {
  it('hides and restores the chrome without writing the saved settings', () => {
    useAppStore.setState({ sidebarOpen: true, rightSidebarOpen: true, statusBarVisible: true })
    const saved = capturePersistedUIWriteBaseline(useAppStore.getState())
    expect(shownChrome(useAppStore.getState())).toEqual([true, true, true])

    useAppStore.getState().enterTerminalFullscreen(target)
    expect(shownChrome(useAppStore.getState())).toEqual([false, false, false])
    expect(capturePersistedUIWriteBaseline(useAppStore.getState())).toEqual(saved)
    expect(useAppStore.getState().statusBarVisible).toBe(true)

    useAppStore.getState().exitTerminalFullscreen()
    expect(shownChrome(useAppStore.getState())).toEqual([true, true, true])
    expect(capturePersistedUIWriteBaseline(useAppStore.getState())).toEqual(saved)
    expect(useAppStore.getState().statusBarVisible).toBe(true)
    expect(uiSet).not.toHaveBeenCalled()
  })

  it('ends fullscreen on a sidebar toggle and keeps a sidebar that was saved open', () => {
    enterFullscreen({ sidebarOpen: true, rightSidebarOpen: true })
    useAppStore.getState().toggleSidebar()
    expect(useAppStore.getState()).toMatchObject({ terminalFullscreen: null, sidebarOpen: true })

    useAppStore.getState().enterTerminalFullscreen(target)
    useAppStore.getState().toggleRightSidebar()
    expect(useAppStore.getState()).toMatchObject({
      terminalFullscreen: null,
      rightSidebarOpen: true
    })
  })

  it('opens a sidebar that was saved closed when its toggle ends fullscreen', () => {
    enterFullscreen({ sidebarOpen: false, rightSidebarOpen: false })
    useAppStore.getState().toggleSidebar()
    expect(useAppStore.getState()).toMatchObject({ terminalFullscreen: null, sidebarOpen: true })

    useAppStore.getState().enterTerminalFullscreen(target)
    useAppStore.getState().toggleRightSidebar()
    expect(useAppStore.getState()).toMatchObject({
      terminalFullscreen: null,
      rightSidebarOpen: true
    })
  })

  it.each([
    ['setSidebarOpen(true)', () => useAppStore.getState().setSidebarOpen(true)],
    ['setRightSidebarOpen(true)', () => useAppStore.getState().setRightSidebarOpen(true)],
    ['showRightSidebarFiles', () => useAppStore.getState().showRightSidebarFiles()],
    ['showRightSidebarSearch', () => useAppStore.getState().showRightSidebarSearch()],
    ['showAiVaultSearch', () => useAppStore.getState().showAiVaultSearch()],
    ['revealInExplorer', () => useAppStore.getState().revealInExplorer('wt-1', '/repo/a.ts')]
  ])('%s ends fullscreen', (_request, request) => {
    enterFullscreen({ sidebarOpen: false, rightSidebarOpen: false })

    request()

    expect(useAppStore.getState().terminalFullscreen).toBeNull()
  })

  it('stays fullscreen when a sidebar is asked to close', () => {
    enterFullscreen({ sidebarOpen: true, rightSidebarOpen: true })

    useAppStore.getState().setSidebarOpen(false)
    useAppStore.getState().setRightSidebarOpen(false)

    expect(useAppStore.getState().terminalFullscreen).toBe(target)
  })

  it('ends fullscreen when the contextual tour reveals the sidebar', () => {
    vi.stubGlobal('document', {
      querySelector: vi.fn((selector: string) =>
        selector ===
        '[data-contextual-tour-target="terminal-pane-split-target"], [data-contextual-tour-target="workspace-agent-terminal-tip"]'
          ? {
              getBoundingClientRect: () => ({
                left: 10,
                top: 10,
                right: 110,
                bottom: 50,
                width: 100,
                height: 40
              })
            }
          : null
      )
    })
    const store = createUIStore()
    store
      .getState()
      .hydratePersistedUI(
        makePersistedUI({ contextualToursAutoEligible: true, sidebarOpen: false })
      )
    store
      .getState()
      .requestContextualTour('workspace-agent-sessions', 'setup_guide_parallel_work', false, {
        force: true
      })
    store.getState().enterTerminalFullscreen(target)

    store.getState().recordFeatureInteraction('terminal-pane-split')

    expect(store.getState()).toMatchObject({ terminalFullscreen: null, sidebarOpen: true })
  })
})
