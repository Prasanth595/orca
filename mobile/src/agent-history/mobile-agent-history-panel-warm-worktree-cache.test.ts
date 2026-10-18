import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setCachedWorktrees } from '../cache/worktree-cache'
import type { Worktree } from '../worktree/workspace-list-types'
import {
  clearMobileAgentHistoryPanelWorktreeCache,
  readInitialMobileAgentHistoryWorktrees,
  recordMobileAgentHistoryPanelWorktrees
} from './mobile-agent-history-worktree-cache'

const historySeed = vi.hoisted(() => {
  let current: {
    hostId: string
    worktreeIds: string[]
    worktreesLoaded: boolean
  } | null = null
  return {
    read: () => current,
    write: (next: { hostId: string; worktreeIds: string[]; worktreesLoaded: boolean }) => {
      current = next
    }
  }
})

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  RefreshControl: 'RefreshControl',
  SectionList: 'SectionList',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  Platform: { OS: 'web', select: (choices: Record<string, unknown>) => choices.web },
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 }
}))
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}))
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))
vi.mock('lucide-react-native', () => ({ ChevronLeft: 'Icon', Play: 'Icon', RefreshCw: 'Icon' }))
vi.mock('../platform/haptics', () => ({ triggerError: () => {}, triggerSuccess: () => {} }))
vi.mock('../components/MobileAgentIcon', () => ({ MobileAgentIcon: () => null }))
vi.mock('../navigation/workspace-route-handoff', () => ({
  useWorkspaceRouteHandoff: () => ({
    push: () => {},
    back: () => {},
    replace: () => {},
    navigate: () => {},
    dismissTo: () => {},
    canGoBack: () => false
  })
}))
vi.mock('../transport/use-workspace-client', () => ({
  useWorkspaceClient: () => ({ client: null, clientId: null, state: 'disconnected' })
}))
vi.mock('./use-mobile-agent-history-state', () => ({
  useMobileAgentHistoryState: (params: {
    hostId: string
    worktrees: readonly { worktreeId: string }[]
    worktreesLoaded: boolean
  }) => {
    historySeed.write({
      hostId: params.hostId,
      worktreeIds: params.worktrees.map((worktree) => worktree.worktreeId),
      worktreesLoaded: params.worktreesLoaded
    })
    const emptyScopeFilterPaths: string[] = []
    return {
      scope: 'workspace' as const,
      screenState: { kind: 'loading' as const },
      refreshing: false,
      hostStatusResult: null,
      activeWorktreePath: null,
      scopeFilterPaths: emptyScopeFilterPaths,
      onSelectScope: () => {},
      onRefresh: async () => {},
      retry: () => {}
    }
  }
}))

import { MobileAgentSessionHistoryPanel } from './MobileAgentSessionHistoryPanel'

describe('mobile-agent-history-worktree-cache', () => {
  beforeEach(() => {
    clearMobileAgentHistoryPanelWorktreeCache()
  })

  afterEach(() => {
    clearMobileAgentHistoryPanelWorktreeCache()
  })

  it('returns empty array when cache is cold', () => {
    expect(readInitialMobileAgentHistoryWorktrees('host-cold')).toEqual([])
  })

  it('seeds initial worktrees from global cache when available', () => {
    const fakeWorktree: Worktree = {
      worktreeId: 'wt-warm',
      path: '/path/to/worktree',
      repoId: 'repo-1'
    }
    setCachedWorktrees('host-warm', [fakeWorktree], { proven: true })
    const initial = readInitialMobileAgentHistoryWorktrees('host-warm')
    expect(initial).toEqual([fakeWorktree])
  })

  it('preserves panel worktrees across reads and updates cache', () => {
    const list: Worktree[] = [
      { worktreeId: 'wt-1', path: '/code/repo1', repoId: 'r1' },
      { worktreeId: 'wt-2', path: '/code/repo2', repoId: 'r2' }
    ]
    recordMobileAgentHistoryPanelWorktrees('host-recorded', list)
    expect(readInitialMobileAgentHistoryWorktrees('host-recorded')).toEqual(list)

    clearMobileAgentHistoryPanelWorktreeCache()
    // Global cache was also populated by recordMobileAgentHistoryPanelWorktrees
    expect(readInitialMobileAgentHistoryWorktrees('host-recorded')).toEqual(list)
  })
})

function cachedWorktree(worktreeId: string, path: string): Worktree {
  return {
    worktreeId,
    repoId: 'repo-1',
    repo: 'Repo',
    branch: 'main',
    displayName: worktreeId,
    path,
    liveTerminalCount: 0,
    hasAttachedPty: false,
    unread: false,
    isPinned: false,
    linkedPR: null
  }
}

describe('MobileAgentSessionHistoryPanel host change', () => {
  let tree: ReactTestRenderer | null = null

  beforeEach(() => {
    clearMobileAgentHistoryPanelWorktreeCache()
  })

  afterEach(() => {
    act(() => {
      tree?.unmount()
    })
    tree = null
    clearMobileAgentHistoryPanelWorktreeCache()
  })

  it('re-seeds worktrees and worktreesLoaded from the new host cache when hostId changes', async () => {
    recordMobileAgentHistoryPanelWorktrees('host-reseed-a', [
      cachedWorktree('wt-a', '/hosts/a')
    ])
    recordMobileAgentHistoryPanelWorktrees('host-reseed-b', [
      cachedWorktree('wt-b', '/hosts/b')
    ])
    let hostId = 'host-reseed-a'
    const panel = () =>
      createElement(MobileAgentSessionHistoryPanel, { hostId, worktreeId: 'wt-a', name: 'A' })

    await act(async () => {
      tree = create(panel())
    })
    expect(historySeed.read()).toEqual({
      hostId: 'host-reseed-a',
      worktreeIds: ['wt-a'],
      worktreesLoaded: true
    })

    hostId = 'host-reseed-b'
    await act(async () => {
      tree?.update(panel())
    })
    expect(historySeed.read()).toEqual({
      hostId: 'host-reseed-b',
      worktreeIds: ['wt-b'],
      worktreesLoaded: true
    })

    hostId = 'host-reseed-cold'
    await act(async () => {
      tree?.update(panel())
    })
    expect(historySeed.read()).toEqual({
      hostId: 'host-reseed-cold',
      worktreeIds: [],
      worktreesLoaded: false
    })
  })
})
