import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyMobileColorScheme, lightColors, darkColors } from '../theme/mobile-theme'
import { AppUpdateCard } from './AppUpdateCard'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View'
}))
vi.mock('lucide-react-native', () => ({ ArrowUpFromLine: 'ArrowUpFromLine', X: 'X' }))

describe('AppUpdateCard', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    applyMobileColorScheme('dark')
  })

  function render() {
    const onPress = vi.fn()
    const onDismiss = vi.fn()
    act(() => {
      renderer = create(createElement(AppUpdateCard, { version: '0.0.51', onPress, onDismiss }))
    })
    const root = renderer!.root
    const texts = root
      .findAll((node) => String(node.type) === 'Text')
      .flatMap((node) => node.children.filter((child) => typeof child === 'string'))
    return { root, texts, onPress, onDismiss }
  }

  it('says which version is available and how to get it, with a monochrome glyph', () => {
    const { root, texts } = render()
    expect(texts).toEqual(['Orca 0.0.51 is available', 'Tap to update'])
    expect(root.find((node) => String(node.type) === 'ArrowUpFromLine').props.color).toBe('#e0e0e0')
  })

  it('updates a mounted card and its icon without changing its props', () => {
    const { root } = render()
    for (const scheme of ['light', 'dark', 'light'] as const) {
      act(() => applyMobileColorScheme(scheme))
      const palette = scheme === 'light' ? lightColors : darkColors
      expect(
        root.findAll((node) => String(node.type) === 'View')[0].props.style.backgroundColor
      ).toBe(palette.bgPanel)
      expect(root.find((node) => String(node.type) === 'ArrowUpFromLine').props.color).toBe(
        palette.textPrimary
      )
    }
  })

  it('opens the update from the card body and dismisses from the X', () => {
    const { root, onPress, onDismiss } = render()
    const [body, dismiss] = root.findAll((node) => String(node.type) === 'Pressable')
    expect(dismiss.props.accessibilityLabel).toBe('Dismiss Orca 0.0.51 update')
    act(() => body.props.onPress())
    expect(onPress).toHaveBeenCalledTimes(1)
    expect(onDismiss).not.toHaveBeenCalled()
    act(() => dismiss.props.onPress())
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
