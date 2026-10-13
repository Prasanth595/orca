import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../index'
import { getDefaultUIState } from '../../../../../shared/constants'

describe('sidebar Active view collapse memory', () => {
  const uiSet = vi.fn(() => Promise.resolve())

  beforeEach(() => {
    uiSet.mockClear()
    vi.stubGlobal('window', { ...globalThis.window, api: { ui: { set: uiSet } } })
    useAppStore.setState({
      sidebarActiveOnly: false,
      collapsedGroups: new Set(['repo:a']),
      sidebarOtherViewCollapsedGroups: new Set()
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens the Active view fully expanded and restores the full view on exit', () => {
    const store = useAppStore.getState()
    store.setSidebarActiveOnly(true)
    expect([...useAppStore.getState().collapsedGroups]).toEqual([])

    useAppStore.getState().toggleCollapsedGroup('repo:b')
    useAppStore.getState().setSidebarActiveOnly(false)
    expect([...useAppStore.getState().collapsedGroups]).toEqual(['repo:a'])

    useAppStore.getState().setSidebarActiveOnly(true)
    expect([...useAppStore.getState().collapsedGroups]).toEqual(['repo:b'])
  })

  it('keeps Active view collapses off disk', () => {
    useAppStore.getState().setSidebarActiveOnly(true)
    useAppStore.getState().toggleCollapsedGroup('repo:b')
    expect(uiSet).not.toHaveBeenCalled()

    useAppStore.getState().setSidebarActiveOnly(false)
    useAppStore.getState().toggleCollapsedGroup('repo:c')
    expect(uiSet).toHaveBeenCalledWith({ collapsedGroups: ['repo:a', 'repo:c'] })
  })

  it('keeps Active view expansion when a saved-UI echo arrives', () => {
    useAppStore.getState().setSidebarActiveOnly(true)
    useAppStore.getState().toggleCollapsedGroup('repo:b')
    // Models main's ui:stateChanged broadcast after an unrelated write, e.g. selecting a worktree.
    useAppStore
      .getState()
      .hydratePersistedUI({ ...getDefaultUIState(), collapsedGroups: ['repo:x'] }, 'sync')
    expect([...useAppStore.getState().collapsedGroups]).toEqual(['repo:b'])

    useAppStore.getState().setSidebarActiveOnly(false)
    expect([...useAppStore.getState().collapsedGroups]).toEqual(['repo:x'])
  })

  it('saves the Always mark inactive list directly and toggles it off again', () => {
    useAppStore.setState({ activeViewHiddenProjectGroupIds: [] })
    useAppStore.getState().toggleActiveViewHiddenProjectGroup('orch')
    expect(useAppStore.getState().activeViewHiddenProjectGroupIds).toEqual(['orch'])
    expect(uiSet).toHaveBeenLastCalledWith({ activeViewHiddenProjectGroupIds: ['orch'] })
    useAppStore.getState().toggleActiveViewHiddenProjectGroup('orch')
    expect(useAppStore.getState().activeViewHiddenProjectGroupIds).toEqual([])
  })

  it('clears both views collapse memory when grouping changes', () => {
    useAppStore.getState().setSidebarActiveOnly(true)
    useAppStore.getState().toggleCollapsedGroup('repo:b')
    useAppStore.getState().setGroupBy('none')
    expect(useAppStore.getState().collapsedGroups.size).toBe(0)
    expect(useAppStore.getState().sidebarOtherViewCollapsedGroups.size).toBe(0)
  })

  it('does not notify subscribers when the view is unchanged', () => {
    let notifications = 0
    const unsubscribe = useAppStore.subscribe(() => {
      notifications += 1
    })
    try {
      useAppStore.getState().setSidebarActiveOnly(false)
    } finally {
      unsubscribe()
    }
    expect(notifications).toBe(0)
  })
})
