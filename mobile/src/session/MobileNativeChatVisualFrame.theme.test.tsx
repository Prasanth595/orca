import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { applyMobileColorScheme, darkColors, lightColors } from '../theme/mobile-theme'

const web = vi.hoisted(() => ({ injectJavaScript: vi.fn() }))
vi.mock('react-native', () => ({ StyleSheet: { create: (value: unknown) => value } }))
vi.mock('react-native-webview', async () => {
  const React = await import('react')
  return {
    WebView: React.forwardRef(function WebView(props, ref) {
      React.useImperativeHandle(ref, () => web)
      return React.createElement('WebView', props)
    })
  }
})
vi.mock('expo-crypto', () => ({ getRandomBytes: (size: number) => new Uint8Array(size) }))
vi.mock('../platform/external-link', () => ({ openExternalLink: vi.fn() }))
import { MobileNativeChatVisualFrame } from './MobileNativeChatVisualFrame'

it('updates a loaded visualization palette in place and reapplies it after a load', () => {
  let tree!: ReturnType<typeof create>
  act(() => {
    tree = create(
      createElement(MobileNativeChatVisualFrame, {
        html: '<p>Chart</p>',
        title: 'Chart',
        mode: 'inline',
        onFailed() {}
      })
    )
  })
  try {
    const frame = () => tree.root.find((node) => String(node.type) === 'WebView')
    const source = frame().props.source
    for (const scheme of ['light', 'dark', 'light'] as const) {
      act(() => applyMobileColorScheme(scheme))
      const palette = scheme === 'light' ? lightColors : darkColors
      expect(frame().props.source).toBe(source)
      expect(web.injectJavaScript).toHaveBeenLastCalledWith(expect.stringContaining(palette.bgBase))
      web.injectJavaScript.mockClear()
      act(() => frame().props.onLoadEnd())
      expect(web.injectJavaScript).toHaveBeenLastCalledWith(expect.stringContaining(palette.bgBase))
    }
  } finally {
    act(() => tree.unmount())
    applyMobileColorScheme('dark')
  }
})
