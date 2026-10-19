// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { processColor } from 'react-native'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { applyMobileColorScheme, darkColors, lightColors } from '../theme/mobile-theme'
import { HostPendingCreationRow } from './host-pending-creation-row'

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

it.each([null, 'orca'])(
  'repaints a pending workspace without replacing its row: %s',
  async (repoName) => {
    await act(async () =>
      root.render(createElement(HostPendingCreationRow, { creation: { key: 'pending', repoName } }))
    )
    const row = container.querySelector('[role="progressbar"]')
    const circle = container.querySelector('circle')
    if (!row || !circle) {
      throw new Error('Missing pending-workspace progress indicator')
    }
    const labels = Array.from(container.querySelectorAll('div')).filter(
      (node) => node.childNodes.length === 1 && node.firstChild?.nodeType === Node.TEXT_NODE
    )
    expect(labels.map((node) => node.textContent)).toEqual(
      repoName ? ['Creating workspace…', repoName] : ['Creating workspace…']
    )
    for (const scheme of ['light', 'dark', 'light'] as const) {
      await act(async () => applyMobileColorScheme(scheme))
      const palette = scheme === 'light' ? lightColors : darkColors
      expect(container.querySelector('[role="progressbar"]')).toBe(row)
      expect(container.querySelector('circle')).toBe(circle)
      expect(processColor(circle.style.stroke)).toBe(processColor(palette.textMuted))
      for (const [index, node] of labels.entries()) {
        const swatch = document.createElement('span')
        swatch.style.color = index === 0 ? palette.textSecondary : palette.textMuted
        expect(processColor(getComputedStyle(node).color)).toBe(processColor(swatch.style.color))
        expect(container.contains(node)).toBe(true)
      }
    }
  }
)
