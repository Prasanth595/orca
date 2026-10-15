import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { colors, onBrightColors } from '../theme/mobile-theme'
import { MobileMarkdown } from './MobileMarkdown'

vi.mock('react-native', () => ({
  Linking: { openURL: () => Promise.resolve() },
  Platform: { OS: 'ios' },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View'
}))
vi.mock('./pr-sidebar/MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

/** The style a span with exactly `text` draws with, nested arrays flattened in order. */
function styleOf(root: ReactTestInstance, text: string): Record<string, unknown> {
  const flatten = (style: unknown): Record<string, unknown> =>
    Array.isArray(style)
      ? Object.assign({}, ...style.map(flatten))
      : typeof style === 'object' && style !== null
        ? { ...style }
        : {}
  const span = root.find(
    (node) =>
      String(node.type) === 'Text' && node.children.length === 1 && node.children[0] === text
  )
  return flatten(span.props.style)
}

it("draws your own message dark on its light fill, and leaves the agent's prose as it was", () => {
  const content = 'Plain **bold** [docs](https://example.com) `code`'
  act(() => {
    renderer = create(createElement(MobileMarkdown, { content, tone: 'onBright' }))
  })
  const own = renderer!.root
  expect(styleOf(own, 'bold').color).toBe(colors.bgBase)
  expect(styleOf(own, 'docs').color).toBe(onBrightColors.link)
  expect(styleOf(own, 'code')).toMatchObject({
    color: colors.bgBase,
    backgroundColor: onBrightColors.codeBackground
  })

  act(() => renderer!.update(createElement(MobileMarkdown, { content })))
  expect(styleOf(renderer!.root, 'bold').color).toBe(colors.textPrimary)
  expect(styleOf(renderer!.root, 'docs').color).toBe(colors.accentBlue)
})
