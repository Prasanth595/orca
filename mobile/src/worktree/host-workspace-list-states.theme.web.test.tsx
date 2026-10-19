// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { processColor } from 'react-native'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { applyMobileColorScheme, darkColors, lightColors } from '../theme/mobile-theme'
import { HostWorkspaceListReopen } from './host-workspace-list-states'

vi.mock('react-native', () => vi.importActual<typeof import('react-native')>('react-native-web'))

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

it('repaints the incompatible-host notice without replacing its text', async () => {
  await act(async () => root.render(createElement(HostWorkspaceListReopen)))
  const labels = Array.from(container.querySelectorAll('div')).filter(
    (node) => node.childNodes.length === 1 && node.firstChild?.nodeType === Node.TEXT_NODE
  )
  expect(labels.map((node) => node.textContent)).toEqual([
    'Reopen to update',
    'This host lists workspaces in a way this page does not know yet.'
  ])
  for (const scheme of ['light', 'dark', 'light'] as const) {
    await act(async () => applyMobileColorScheme(scheme))
    const palette = scheme === 'light' ? lightColors : darkColors
    for (const [index, expected] of [palette.textSecondary, palette.textMuted].entries()) {
      const swatch = document.createElement('span')
      swatch.style.color = expected
      expect(processColor(getComputedStyle(labels[index]).color)).toBe(
        processColor(swatch.style.color)
      )
      expect(container.contains(labels[index])).toBe(true)
    }
  }
})
