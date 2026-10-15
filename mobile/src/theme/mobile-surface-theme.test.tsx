vi.mock('../home/MobileHomeAppUpdateCard', () => ({ MobileHomeAppUpdateCard: () => null }))
vi.mock('expo-router', () => ({ useRouter: () => ({ push() {} }) }))
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { applyMobileColorScheme, darkColors, lightColors } from './mobile-theme'

vi.mock('react-native', () => ({
  Animated: {
    View: 'AnimatedView',
    Value: class {
      setValue() {}
      interpolate() {
        return 'rotation'
      }
    },
    loop: () => ({ start() {}, stop() {} }),
    timing: () => ({})
  },
  Easing: { linear: 'linear' },
  Text: 'Text',
  View: 'View',
  Platform: {
    OS: 'android',
    select: (values: Record<string, unknown>) => values.android ?? values.default
  },
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 }
}))
vi.mock('lucide-react-native', () => ({ Activity: 'Activity' }))
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }))
vi.mock('../host-screen/host-screen-header', () => ({ HostScreenHeader: () => null }))
vi.mock('../host-screen/host-screen-overlays', () => ({ HostScreenOverlays: () => null }))
vi.mock('../host-screen/host-workspace-list', () => ({ HostWorkspaceList: () => null }))
import { AgentStateDot } from '../components/AgentStateDot'
import { AgentSpinner } from '../components/AgentSpinner'
import { styles as sessionStyles } from '../session/mobile-session-styles'
import { styles as sourceStyles } from '../source-control/mobile-source-control-styles'
import { styles as taskStyles } from '../tasks/mobile-tasks-legacy-styles'
import { mobileDiffReviewStyles } from '../components/mobile-diff-review-screen-styles'
import { HostScreenView } from '../host-screen/host-screen-view'
import { MobileHomeListHeader } from '../home/MobileHomeListHeader'
import type { HostScreenController } from '../host-screen/use-host-screen-controller'

let tree: ReactTestRenderer | null = null
afterEach(() => {
  act(() => tree?.unmount())
  applyMobileColorScheme('dark')
})
it('repaints the mounted machine screen without rebuilding its controller', () => {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: child views are stubbed; this view only reads state.error.
  const controller = { state: { error: null } } as unknown as HostScreenController
  act(() => {
    tree = create(createElement(HostScreenView, { controller }))
  })
  const background = () =>
    tree!.root.find((node) => String(node.type) === 'SafeAreaView').props.style.backgroundColor
  expect(background()).toBe(darkColors.bgBase)
  act(() => applyMobileColorScheme('light'))
  expect(background()).toBe(lightColors.bgBase)
  act(() => applyMobileColorScheme('dark'))
  expect(background()).toBe(darkColors.bgBase)
})
it('uses a light surface behind all three home statistics', () => {
  applyMobileColorScheme('light')
  act(() => {
    tree = create(
      createElement(MobileHomeListHeader, {
        stats: {
          totalAgentsSpawned: 3,
          totalAgentTimeMs: 60000,
          totalPRsCreated: 2,
          firstEventAt: null
        }
      })
    )
  })
  const cards = tree!.root.findAll(
    (node) => String(node.type) === 'View' && node.props.style?.borderWidth === 1
  )
  expect(cards).toHaveLength(3)
  expect(cards.map((node) => node.props.style.backgroundColor)).toEqual(
    Array(3).fill(lightColors.bgPanel)
  )
})

it.each([
  ['session', () => sessionStyles.container],
  ['source control', () => sourceStyles.container],
  ['tasks', () => taskStyles.container],
  ['diff', () => mobileDiffReviewStyles.safeArea]
] as const)('keeps merged %s surfaces live across both palettes', (_name, surface) => {
  applyMobileColorScheme('light')
  expect(surface().backgroundColor).toBe(lightColors.bgBase)
  applyMobileColorScheme('dark')
  expect(surface().backgroundColor).toBe(darkColors.bgBase)
})

it('repaints running indicators in place without restarting their state', () => {
  act(() => {
    tree = create(createElement(AgentSpinner, { status: 'working' }))
  })
  const color = () =>
    tree!.root.find((node) => String(node.type) === 'AnimatedView').props.style[1].borderColor
  expect(color()).toBe(darkColors.agentWorking)
  act(() => applyMobileColorScheme('light'))
  expect(color()).toBe(lightColors.agentWorking)
})
it('uses theme contrast for the per-agent indicator too', () => {
  act(() => {
    tree = create(createElement(AgentStateDot, { state: 'working' }))
  })
  const color = () =>
    tree!.root.find((node) => String(node.type) === 'AnimatedView').props.style[0].borderColor
  expect(color()).toBe(darkColors.agentWorking)
  act(() => applyMobileColorScheme('light'))
  expect(color()).toBe(lightColors.agentWorking)
})
