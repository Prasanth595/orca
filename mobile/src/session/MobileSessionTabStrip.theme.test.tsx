import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { applyMobileColorScheme, darkColors, lightColors } from '../theme/mobile-theme'
import type { MobileSessionController } from './use-mobile-session-controller'
import { MobileSessionTabStrip } from './MobileSessionTabStrip'

vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Platform: { select: (values: Record<string, unknown>) => values.default },
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 }
}))
vi.mock('lucide-react-native', () => ({
  File: 'File',
  FileText: 'FileText',
  Globe: 'Globe',
  Plus: 'Plus'
}))
vi.mock('../components/MobileAgentIcon', () => ({ MobileAgentIcon: () => null }))
vi.mock('../platform/haptics', () => ({ triggerMediumImpact: vi.fn() }))
vi.mock('../platform/keyboard-persisting-taps', () => ({
  useKeyboardPersistingTaps: () => null
}))
vi.mock('./QuickCommandsTabButton', () => ({ QuickCommandsTabButton: () => null }))

let tree: ReactTestRenderer | null = null
afterEach(() => {
  act(() => tree?.unmount())
  tree = null
  applyMobileColorScheme('dark')
})

it.each([false, true])(
  'repaints mounted tabs without resetting navigation (top bar: %s)',
  (inTopBar) => {
    const switchSessionTab = vi.fn()
    const controller: Partial<MobileSessionController> = {
      connState: 'connected',
      activeSessionTabId: 'first',
      activeSessionTabIdRef: { current: 'first' },
      tabStripRef: { current: null },
      tabStripOffsetRef: { current: 0 },
      tabStripViewportWidthRef: { current: 0 },
      tabStripContentWidthRef: { current: 0 },
      tabLayoutsRef: { current: new Map() },
      creating: false,
      creatingBrowser: false,
      creatingMarkdown: false,
      setCreateError: vi.fn(),
      setShowCreateTabDrawer: vi.fn(),
      setShowQuickCommands: vi.fn(),
      quickCommandsSupported: true,
      showToast: vi.fn(),
      scrollActiveTabIntoView: vi.fn(),
      switchSessionTab,
      openSessionTabActionSheetAfterKeyboardDismiss: vi.fn(),
      visibleTabs: [
        {
          id: 'first',
          type: 'browser',
          title: 'Preview',
          url: 'https://example.com',
          browserWorkspaceId: 'workspace',
          browserPageId: 'page-1',
          loading: false,
          canGoBack: false,
          canGoForward: false,
          isActive: true
        },
        {
          id: 'second',
          type: 'browser',
          title: 'Docs',
          url: 'https://example.com/docs',
          browserWorkspaceId: 'workspace',
          browserPageId: 'page-2',
          loading: false,
          canGoBack: false,
          canGoForward: false,
          isActive: false
        }
      ]
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the fixture provides every field read by this extracted tab strip.
    const tabController = controller as MobileSessionController
    act(() => {
      tree = create(createElement(MobileSessionTabStrip, { controller: tabController, inTopBar }))
    })
    if (!tree) {
      throw new Error('Tab strip did not mount')
    }
    const mounted = tree
    const rows = () => mounted.root.findAll((node) => String(node.type) === 'Pressable')
    const selected = rows()[0]
    controller.tabStripOffsetRef!.current = 80
    controller.tabLayoutsRef!.current.set('first', { x: 0, width: 128 })
    for (const scheme of ['light', 'dark', 'light'] as const) {
      act(() => applyMobileColorScheme(scheme))
      const palette = scheme === 'light' ? lightColors : darkColors
      expect(rows()[0]).toBe(selected)
      expect(selected.props.style[2].backgroundColor).toBe(palette.bgRaised)
      expect(selected.props.style[0].borderRightColor).toBe(palette.borderSubtle)
      const labels = mounted.root.findAll((node) => String(node.type) === 'Text')
      expect(labels[0].props.style[1].color).toBe(palette.textPrimary)
      expect(labels[1].props.style[0].color).toBe(palette.textSecondary)
      expect(mounted.root.findAll((node) => String(node.type) === 'Globe')[0].props.color).toBe(
        palette.textSecondary
      )
      expect(controller.tabStripOffsetRef!.current).toBe(80)
      expect(controller.tabLayoutsRef!.current.get('first')).toEqual({ x: 0, width: 128 })
    }
    act(() => rows()[1].props.onPress())
    expect(switchSessionTab).toHaveBeenCalledExactlyOnceWith(controller.visibleTabs![1])
  }
)
