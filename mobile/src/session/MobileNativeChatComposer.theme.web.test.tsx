// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { processColor } from 'react-native'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { applyMobileColorScheme, darkColors, lightColors } from '../theme/mobile-theme'
import { MobileNativeChatComposerField } from './MobileNativeChatComposerField.web'
import { MobileNativeChatComposerMenu } from './MobileNativeChatComposerMenu'
import { MobileNativeChatComposerAttachments } from './MobileNativeChatComposerAttachments'

vi.mock('react-native', () => vi.importActual<typeof import('react-native')>('react-native-web'))
vi.mock('lucide-react-native', () => ({
  FileText: () => null,
  Package: () => null,
  Terminal: () => null,
  X: () => null
}))

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  applyMobileColorScheme('dark')
})

function textNode(text: string): HTMLElement {
  const node = Array.from(container.querySelectorAll('*')).find(
    (element) =>
      element.childNodes.length === 1 &&
      element.firstChild?.nodeType === Node.TEXT_NODE &&
      element.textContent === text
  )
  if (!(node instanceof HTMLElement)) {
    throw new Error(`Missing text: ${text}`)
  }
  return node
}
function expectColor(element: HTMLElement, expected: string): void {
  const swatch = document.createElement('span')
  swatch.style.color = expected
  expect(processColor(getComputedStyle(element).color)).toBe(processColor(swatch.style.color))
}

it('repaints the highlighted skill while retaining the same editable draft', async () => {
  const value = '/review-pr preserve the draft'
  await act(async () =>
    root.render(
      createElement(MobileNativeChatComposerField, {
        value,
        skillToken: '/review-pr',
        multiline: true,
        onChangeText: vi.fn()
      })
    )
  )
  const field = container.querySelector('textarea')
  expect(field).not.toBeNull()
  const token = textNode('/review-pr')
  for (const scheme of ['light', 'dark', 'light'] as const) {
    await act(async () => applyMobileColorScheme(scheme))
    const palette = scheme === 'light' ? lightColors : darkColors
    expectColor(token, palette.skillToken)
    expect(container.querySelector('textarea')).toBe(field)
    expect(field?.value).toBe(value)
    expect(textNode('/review-pr')).toBe(token)
  }
})

it('repaints a plain draft without replacing its text field', async () => {
  await act(async () =>
    root.render(
      createElement(MobileNativeChatComposerField, {
        value: 'Keep my draft',
        skillToken: null,
        multiline: true,
        onChangeText: vi.fn()
      })
    )
  )
  const field = container.querySelector('textarea')
  if (!(field instanceof HTMLElement)) {
    throw new Error('Missing draft field')
  }
  for (const scheme of ['light', 'dark', 'light'] as const) {
    await act(async () => applyMobileColorScheme(scheme))
    expectColor(field, (scheme === 'light' ? lightColors : darkColors).textPrimary)
    expect(container.querySelector('textarea')).toBe(field)
  }
})

it('repaints an open skills menu without replacing its selection action', async () => {
  const onPick = vi.fn()
  const skill = {
    id: 'review',
    kind: 'skill' as const,
    token: '/review-pr',
    name: 'review-pr',
    description: 'Review a pull request',
    sources: []
  }
  await act(async () =>
    root.render(createElement(MobileNativeChatComposerMenu, { rows: [skill], onPick }))
  )
  const choice = container.querySelector('[aria-label="/review-pr"]')
  for (const scheme of ['light', 'dark', 'light'] as const) {
    await act(async () => applyMobileColorScheme(scheme))
    expectColor(textNode('/review-pr'), (scheme === 'light' ? lightColors : darkColors).textPrimary)
    expect(container.querySelector('[aria-label="/review-pr"]')).toBe(choice)
  }
  if (!(choice instanceof HTMLElement)) {
    throw new Error('Missing skill choice')
  }
  await act(async () => choice.click())
  expect(onPick).toHaveBeenCalledExactlyOnceWith(skill)
})

it('repaints a staged file without losing its remove action', async () => {
  const onRemoveFile = vi.fn()
  const file = {
    id: 'file-1',
    name: 'README.txt',
    mime: 'text/plain',
    byteLength: 16,
    path: '/host/README.txt'
  }
  await act(async () =>
    root.render(
      createElement(MobileNativeChatComposerAttachments, {
        images: [],
        files: [file],
        onRemoveFile
      })
    )
  )
  const remove = container.querySelector('[aria-label="Remove README.txt"]')
  for (const scheme of ['light', 'dark', 'light'] as const) {
    await act(async () => applyMobileColorScheme(scheme))
    expectColor(textNode('README.txt'), (scheme === 'light' ? lightColors : darkColors).textPrimary)
    expect(container.querySelector('[aria-label="Remove README.txt"]')).toBe(remove)
  }
  if (!(remove instanceof HTMLElement)) {
    throw new Error('Missing staged file remove action')
  }
  await act(async () => remove.click())
  expect(onRemoveFile).toHaveBeenCalledExactlyOnceWith('file-1')
})
