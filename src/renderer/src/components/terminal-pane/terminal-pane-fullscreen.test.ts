import { describe, expect, it, vi } from 'vitest'
import type { TerminalFullscreenTarget } from '@/store/slices/ui'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import { brandEphemeralSetupTerminalWorktreeId } from '../../../../shared/ephemeral-setup-terminal-worktree-id'
import {
  canOfferTerminalFullscreen,
  createTerminalPaneFullscreenActions,
  selectTerminalFullscreenLeafId
} from './terminal-pane-fullscreen'

type FullscreenStateForTest = Parameters<typeof createTerminalPaneFullscreenActions>[0]

function ref<T>(current: T): React.MutableRefObject<T> {
  return { current }
}

function pane(id: number) {
  return { id, leafId: `leaf-${id}`, terminal: { focus: vi.fn() } }
}

function createState(paneIds: number[], expandedPaneId: number | null = null) {
  const panes = paneIds.map(pane)
  const expandedPaneIdRef = ref<number | null>(expandedPaneId)
  const setActivePane = vi.fn()
  const state = {
    managerRef: ref({
      getPanes: () => panes,
      getNumericIdForLeaf: (leafId: string) =>
        panes.find((candidate) => candidate.leafId === leafId)?.id ?? null,
      setActivePane
    }),
    expandedPaneIdRef,
    hostedTargetRef: ref<TerminalFullscreenTarget | null>(null),
    worktreeId: 'wt-1',
    tabId: 'tab-1',
    // Mirrors Expand Pane: toggles the clicked pane in and out of the expanded slot.
    toggleExpandPane: vi.fn((paneId: number) => {
      expandedPaneIdRef.current = expandedPaneIdRef.current === paneId ? null : paneId
    }),
    setExpandedPane: vi.fn((paneId: number | null) => {
      expandedPaneIdRef.current = paneId
    }),
    restoreExpandedLayout: vi.fn(),
    refreshPaneSizes: vi.fn()
  } satisfies FullscreenStateForTest
  return { state, setActivePane, actions: createTerminalPaneFullscreenActions(state) }
}

describe('createTerminalPaneFullscreenActions', () => {
  it('does not expand a single pane', () => {
    const { state, setActivePane, actions } = createState([1])
    const clicked = pane(1)

    const target = actions.enter(clicked)

    expect(target).toEqual({
      worktreeId: 'wt-1',
      tabId: 'tab-1',
      leafId: 'leaf-1',
      expandedPane: false
    })
    expect(state.toggleExpandPane).not.toHaveBeenCalled()
    expect(setActivePane).toHaveBeenCalledWith(1)
    expect(clicked.terminal.focus).toHaveBeenCalledTimes(1)
    expect(state.hostedTargetRef.current).toBe(target)
  })

  it('expands the pane of a split tab with Expand Pane and records it', () => {
    const { state, actions } = createState([1, 2])

    const target = actions.enter(pane(2))

    expect(state.toggleExpandPane).toHaveBeenCalledWith(2)
    expect(state.expandedPaneIdRef.current).toBe(2)
    expect(target.expandedPane).toBe(true)
  })

  it('records a pane that was already expanded as not expanded by fullscreen', () => {
    const { state, actions } = createState([1, 2], 1)

    const target = actions.enter(pane(1))

    expect(state.toggleExpandPane).not.toHaveBeenCalled()
    expect(target.expandedPane).toBe(false)
  })

  it('collapses on exit when fullscreen expanded the pane and it is still expanded', () => {
    const { state, setActivePane, actions } = createState([1, 2])
    actions.enter(pane(1))
    setActivePane.mockClear()
    const clicked = pane(1)

    actions.exit(clicked)

    expect(state.setExpandedPane).toHaveBeenCalledWith(null)
    expect(state.restoreExpandedLayout).toHaveBeenCalledTimes(1)
    expect(state.expandedPaneIdRef.current).toBeNull()
    expect(state.refreshPaneSizes).toHaveBeenCalledWith(true)
    expect(setActivePane).toHaveBeenCalledWith(1)
    expect(clicked.terminal.focus).toHaveBeenCalledTimes(1)
    expect(state.hostedTargetRef.current).toBeNull()
  })

  it('leaves the layout alone on exit when the pane was expanded before fullscreen', () => {
    const { state, actions } = createState([1, 2], 1)
    actions.enter(pane(1))

    actions.exit(pane(1))

    expect(state.setExpandedPane).not.toHaveBeenCalled()
    expect(state.restoreExpandedLayout).not.toHaveBeenCalled()
    expect(state.expandedPaneIdRef.current).toBe(1)
    expect(state.refreshPaneSizes).toHaveBeenCalledWith(true)
  })

  it('leaves the layout alone on exit when the pane was collapsed during fullscreen', () => {
    const { state, actions } = createState([1, 2])
    actions.enter(pane(1))
    state.toggleExpandPane(1)

    actions.exit(pane(1))

    expect(state.setExpandedPane).not.toHaveBeenCalled()
    expect(state.restoreExpandedLayout).not.toHaveBeenCalled()
  })

  it('restores without focusing when fullscreen ends automatically', () => {
    const { state, actions } = createState([1, 2])
    actions.enter(pane(1))
    state.refreshPaneSizes.mockClear()

    actions.release(null)

    expect(state.setExpandedPane).toHaveBeenCalledWith(null)
    expect(state.restoreExpandedLayout).toHaveBeenCalledTimes(1)
    expect(state.refreshPaneSizes).toHaveBeenCalledWith(false)
    expect(state.refreshPaneSizes).not.toHaveBeenCalledWith(true)
    expect(state.hostedTargetRef.current).toBeNull()
  })

  it('restores without focusing when the target moves to another tab', () => {
    const { state, actions } = createState([1, 2])
    actions.enter(pane(1))
    state.refreshPaneSizes.mockClear()

    actions.release({ worktreeId: 'wt-1', tabId: 'tab-2', leafId: 'leaf-9', expandedPane: false })

    expect(state.expandedPaneIdRef.current).toBeNull()
    expect(state.refreshPaneSizes).toHaveBeenCalledWith(false)
    expect(state.refreshPaneSizes).not.toHaveBeenCalledWith(true)
  })

  it('restores the previous pane without focusing when the target moves within the tab', () => {
    const { state, actions } = createState([1, 2])
    actions.enter(pane(1))
    // Collapse Pane keeps working while fullscreen is on, which brings pane 2 back into reach.
    state.toggleExpandPane(1)
    state.refreshPaneSizes.mockClear()
    state.toggleExpandPane.mockClear()

    const target = actions.enter(pane(2))

    expect(state.refreshPaneSizes).toHaveBeenNthCalledWith(1, false)
    expect(state.toggleExpandPane).toHaveBeenCalledWith(2)
    expect(target).toMatchObject({ leafId: 'leaf-2', expandedPane: true })
    expect(state.hostedTargetRef.current).toBe(target)
  })

  it('does nothing while the stored target is still this pane', () => {
    const { state, actions } = createState([1, 2])
    const target = actions.enter(pane(1))
    state.refreshPaneSizes.mockClear()

    actions.release(target)

    expect(state.refreshPaneSizes).not.toHaveBeenCalled()
    expect(state.hostedTargetRef.current).toBe(target)
  })
})

describe('canOfferTerminalFullscreen', () => {
  const offered: Parameters<typeof canOfferTerminalFullscreen>[0] = {
    activeView: 'terminal',
    activeWorktreeId: 'wt-1',
    worktreeId: 'wt-1',
    isolatedPaneKey: null
  }

  it('offers fullscreen to terminals of the workspace in the workspace view', () => {
    expect(canOfferTerminalFullscreen(offered)).toBe(true)
  })

  it('withholds it on other pages, other workspaces, and Activity portals', () => {
    expect(canOfferTerminalFullscreen({ ...offered, activeView: 'activity' })).toBe(false)
    expect(canOfferTerminalFullscreen({ ...offered, activeWorktreeId: 'wt-2' })).toBe(false)
    expect(canOfferTerminalFullscreen({ ...offered, isolatedPaneKey: 'tab-1:leaf-1' })).toBe(false)
  })

  it('withholds it from the floating panel and setup terminals', () => {
    expect(
      canOfferTerminalFullscreen({ ...offered, worktreeId: FLOATING_TERMINAL_WORKTREE_ID })
    ).toBe(false)
    expect(
      canOfferTerminalFullscreen({
        ...offered,
        worktreeId: brandEphemeralSetupTerminalWorktreeId('setup-1')
      })
    ).toBe(false)
  })
})

describe('selectTerminalFullscreenLeafId', () => {
  const target = { worktreeId: 'wt-1', tabId: 'tab-1', leafId: 'leaf-1', expandedPane: false }

  it("returns this tab's fullscreen leaf and null for every other tab", () => {
    expect(selectTerminalFullscreenLeafId(target, 'wt-1', 'tab-1')).toBe('leaf-1')
    expect(selectTerminalFullscreenLeafId(target, 'wt-1', 'tab-2')).toBeNull()
    expect(selectTerminalFullscreenLeafId(target, 'wt-2', 'tab-1')).toBeNull()
    expect(selectTerminalFullscreenLeafId(null, 'wt-1', 'tab-1')).toBeNull()
  })
})
