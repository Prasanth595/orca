import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const doubles = vi.hoisted(() => ({
  routerBack: vi.fn(),
  useBackClaim: vi.fn()
}))

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View'
}))
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }))
vi.mock('../navigation/use-back-claim', () => ({
  useBackClaim: (claim: (() => boolean) | null) => {
    doubles.useBackClaim(claim)
  }
}))
// The panel's collaborators, each rendering nothing: what is under test is the back claim.
vi.mock('./MobileSourceControlHeader', () => ({ MobileSourceControlHeader: () => null }))
vi.mock('./MobileSourceControlContent', () => ({ MobileSourceControlContent: () => null }))
vi.mock('./MobileSourceControlModals', () => ({ MobileSourceControlModals: () => null }))
vi.mock('./MobileSourceControlSegments', () => ({ MobileSourceControlSegments: () => null }))
vi.mock('./MobileSourceControlBranchCard', () => ({ MobileSourceControlBranchCard: () => null }))
vi.mock('./MobileGitHistoryList', () => ({ MobileGitHistoryList: () => null }))
vi.mock('../components/pr-sidebar/MobilePrViewPanel', () => ({ MobilePrViewPanelBody: () => null }))
vi.mock('../components/mobile-pr-url', () => ({ openMobilePrUrl: () => {} }))
vi.mock('./use-mobile-source-control-action-sheet', () => ({
  useMobileSourceControlActionSheet: () => ({})
}))
vi.mock('../session/use-mobile-pr-sidebar-controller', () => ({
  useMobilePrSidebarController: () => ({
    prSidebarIsGithubRepo: false,
    prSidebarState: { kind: 'hidden' },
    prSidebarRepoProbeLoaded: false,
    refetchPRSidebar: () => Promise.resolve(),
    ensurePrSidebarDetails: () => Promise.resolve()
  })
}))
vi.mock('./use-mobile-source-control-state', () => ({
  useMobileSourceControlState: () => ({
    client: null,
    connState: 'connected',
    forceReconnect: null,
    insets: { top: 0, bottom: 0, left: 0, right: 0 },
    router: { back: doubles.routerBack },
    setRootRef: () => {},
    worktreeLabel: 'wt',
    screenState: { kind: 'loading' },
    busyAction: null,
    openingPath: null,
    openingBranchPath: null,
    loadStatus: () => Promise.resolve(),
    status: null,
    branchCompareResult: null,
    branchLabel: '',
    syncLabel: '',
    unstagedCount: 0,
    stagedCount: 0,
    branchEntries: [],
    abortConflictOperation: () => Promise.resolve()
  })
}))

import { MobileSourceControlPanel } from './MobileSourceControlPanel'

let tree: ReactTestRenderer | null = null

beforeEach(() => {
  doubles.routerBack.mockClear()
  doubles.useBackClaim.mockClear()
})

afterEach(() => {
  act(() => tree?.unmount())
  tree = null
})

function render(props: { embedded?: boolean; onRequestClose?: () => void }): void {
  act(() => {
    tree = create(
      createElement(MobileSourceControlPanel, {
        hostId: 'host-a',
        worktreeId: 'wt-1',
        embedded: props.embedded,
        onRequestClose: props.onRequestClose
      })
    )
  })
}

function activeClaim(): () => boolean {
  const calls = doubles.useBackClaim.mock.calls
  const claim = calls[calls.length - 1]?.[0]
  if (typeof claim !== 'function') {
    throw new Error('useBackClaim was not given a handler')
  }
  return claim
}

describe('source control claims the device Back key', () => {
  it('registers the active back handler', () => {
    render({ embedded: false })
    expect(doubles.useBackClaim).toHaveBeenCalled()
    expect(typeof activeClaim()).toBe('function')
  })

  it('pops the route when the screen is standalone', () => {
    render({ embedded: false })
    expect(activeClaim()()).toBe(true)
    expect(doubles.routerBack).toHaveBeenCalledTimes(1)
  })

  it('closes the dock when the screen is embedded', () => {
    const onRequestClose = vi.fn()
    render({ embedded: true, onRequestClose })
    expect(activeClaim()()).toBe(true)
    expect(onRequestClose).toHaveBeenCalledTimes(1)
    expect(doubles.routerBack).not.toHaveBeenCalled()
  })
})
