import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { RuntimeWorktreeAgentRow } from '../../../src/shared/runtime-types'
import type { Worktree } from '../worktree/workspace-list-types'

type FocusEffect = () => void | (() => void)

type TestState = {
  hostId: string
  client: object
  push: ReturnType<typeof vi.fn>
  request: ReturnType<typeof vi.fn>
  focusEffect?: FocusEffect
}

const testState = vi.hoisted((): TestState => ({
  hostId: 'host-a',
  client: {},
  push: vi.fn(),
  request: vi.fn(),
  focusEffect: undefined
}))

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  FlatList: 'FlatList',
  Pressable: 'Pressable',
  RefreshControl: 'RefreshControl',
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  View: 'View'
}))
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ bottom: 0 })
}))
vi.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    testState.focusEffect = effect
  },
  useLocalSearchParams: () => ({ hostId: testState.hostId }),
  useRouter: () => ({ back: vi.fn(), push: testState.push })
}))
vi.mock('lucide-react-native', () => ({ ChevronLeft: 'ChevronLeft', RefreshCw: 'RefreshCw' }))
vi.mock('../cache/worktree-cache', () => ({ setCachedWorktrees: vi.fn() }))
vi.mock('../hooks/use-now', () => ({ useNow: () => 0 }))
vi.mock('../navigation/route-param-reader', () => ({ firstParam: (value: string) => value }))
vi.mock('../transport/client-context', () => ({
  useHostClient: () => ({ client: testState.client, state: 'connected' })
}))
vi.mock('../transport/host-store', () => ({ loadHosts: async () => [] }))
vi.mock('../worktree/worktree-catalog-operations', () => ({
  worktreeCatalogRead: {
    requestSingleFlight: testState.request,
    interpret: (reply: unknown) => ({ accepted: true, value: reply })
  }
}))
vi.mock('../worktree/worktree-catalog-snapshot-client', () => ({ WORKTREE_PS_FULL_LIMIT: 1000 }))
vi.mock('../components/AgentStateDot', () => ({ AgentStateDot: 'AgentStateDot' }))
vi.mock('../components/MobileAgentIcon', () => ({ MobileAgentIcon: 'MobileAgentIcon' }))

import { MobileAgentRosterScreen } from './MobileAgentRosterScreen'

const agent: RuntimeWorktreeAgentRow = {
  paneKey: 'pane-1',
  parentPaneKey: null,
  state: 'working',
  agentType: 'claude',
  prompt: 'Review the roster',
  taskTitle: 'Roster navigation',
  displayName: null,
  lastAssistantMessage: 'Working',
  toolName: null,
  toolInput: null,
  interrupted: false,
  stateStartedAt: 100,
  updatedAt: 200
}

const worktree: Worktree = {
  worktreeId: 'wt-1',
  repoId: 'repo-1',
  repo: 'orca',
  branch: 'main',
  displayName: 'feature',
  path: '/tmp/orca/feature',
  liveTerminalCount: 0,
  hasAttachedPty: false,
  preview: '',
  unread: false,
  isPinned: false,
  linkedPR: null,
  agents: [agent]
}

function resetTestState() {
  testState.hostId = 'host-a'
  testState.push.mockReset()
  testState.request.mockReset()
  testState.request.mockResolvedValue({ worktrees: [worktree] })
  testState.focusEffect = undefined
}

async function mountScreen(): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined
  await act(async () => {
    renderer = create(createElement(MobileAgentRosterScreen))
    await Promise.resolve()
  })
  if (!renderer) {
    throw new Error('screen did not mount')
  }
  return renderer
}

async function pressFirstAgent(renderer: ReactTestRenderer) {
  await act(async () => {
    await Promise.resolve()
  })
  const list = renderer.root.find((node: ReactTestInstance) => String(node.type) === 'FlatList')
  const entry = list.props.data[0]
  let row: ReactTestRenderer | undefined
  act(() => {
    row = create(list.props.renderItem({ item: entry }))
  })
  if (!row) {
    throw new Error('agent row did not mount')
  }
  const renderedRow = row
  act(() => {
    renderedRow.root
      .find((node: ReactTestInstance) => String(node.type) === 'Pressable')
      .props.onPress()
  })
}

describe('MobileAgentRosterScreen navigation guard', () => {
  it('pushes only once for repeated taps on the same row', async () => {
    resetTestState()
    const renderer = await mountScreen()

    await pressFirstAgent(renderer)
    await pressFirstAgent(renderer)

    expect(testState.push).toHaveBeenCalledOnce()
  })

  it('allows another open after the roster regains focus', async () => {
    resetTestState()
    const renderer = await mountScreen()
    const focusEffect = testState.focusEffect
    if (!focusEffect) {
      throw new Error('focus effect was not registered')
    }

    let cleanup: (() => void) | undefined
    await act(async () => {
      const focusCleanup = focusEffect()
      if (typeof focusCleanup === 'function') {
        cleanup = focusCleanup
      }
      await Promise.resolve()
    })
    await pressFirstAgent(renderer)
    if (cleanup) {
      cleanup()
      await act(async () => {
        await Promise.resolve()
      })
    }
    await pressFirstAgent(renderer)
    expect(testState.push).toHaveBeenCalledTimes(1)
    await act(async () => {
      focusEffect()
      await Promise.resolve()
    })
    await pressFirstAgent(renderer)

    expect(testState.push).toHaveBeenCalledTimes(2)
  })

  it('clears the guard when the host changes', async () => {
    resetTestState()
    const renderer = await mountScreen()
    await pressFirstAgent(renderer)

    testState.hostId = 'host-b'
    await act(async () => {
      renderer.update(createElement(MobileAgentRosterScreen))
      await Promise.resolve()
    })
    await pressFirstAgent(renderer)

    expect(testState.push).toHaveBeenCalledTimes(2)
  })

  it('allows retry when router.push throws synchronously', async () => {
    resetTestState()
    testState.push.mockImplementationOnce(() => {
      throw new Error('navigation unavailable')
    })
    const renderer = await mountScreen()

    await pressFirstAgent(renderer)
    await pressFirstAgent(renderer)

    expect(testState.push).toHaveBeenCalledTimes(2)
  })
})
