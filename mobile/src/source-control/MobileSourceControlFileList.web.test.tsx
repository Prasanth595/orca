// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { processColor } from 'react-native'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileSourceControlFileList, type FileListState } from './MobileSourceControlFileList'
import { applyMobileColorScheme, darkColors, lightColors } from '../theme/mobile-theme'

vi.mock('react-native', () => vi.importActual<typeof import('react-native')>('react-native-web'))
vi.mock('lucide-react-native', () => ({
  ArrowDown: () => null,
  ArrowDownUp: () => null,
  ArrowUp: () => null,
  Check: () => null,
  ChevronRight: () => null,
  CloudUpload: () => null,
  FileText: () => null,
  GitBranch: () => null,
  GitPullRequestArrow: () => null,
  History: () => null,
  Minus: () => null,
  Plus: () => null,
  RefreshCw: () => null,
  Trash2: () => null
}))

function fileListState(count: number, dirty: boolean): FileListState {
  const branchEntries = Array.from({ length: count }, (_, index) => ({
    path: `src/committed-${index}.ts`,
    status: 'modified' as const,
    added: 1,
    removed: 0,
    canOpen: true
  }))
  const branchCompareResult = {
    summary: {
      status: 'ready' as const,
      baseRef: 'main',
      changedFiles: count,
      commitsAhead: 1,
      errorMessage: undefined
    },
    entries: branchEntries
  }
  return {
    sections: dirty
      ? [
          {
            area: 'unstaged',
            title: 'Changes',
            data: [
              {
                area: 'unstaged',
                path: 'src/uncommitted.ts',
                status: 'modified',
                canOpen: true,
                canStage: true,
                canDiscard: true,
                stageActionId: 'stage:src/uncommitted.ts',
                unstageActionId: 'unstage:src/uncommitted.ts',
                discardActionId: 'discard:src/uncommitted.ts'
              }
            ]
          }
        ]
      : [],
    shouldShowBranchCompareSection: true,
    branchCompareSummaryText: `${count} files vs main`,
    branchEntries,
    branchCompareState: { kind: 'ready', result: branchCompareResult },
    branchCompareResult,
    busyAction: null,
    openingPath: null,
    openingBranchPath: null,
    openFile: vi.fn(async () => {}),
    openBranchDiff: vi.fn(async () => {}),
    runGitAction: vi.fn(async () => true),
    setDiscardTarget: vi.fn()
  }
}

describe('source-control file virtualization in the mobile web page', () => {
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

  it('repaints a mounted virtualized list without replacing rows or their actions', async () => {
    const state = fileListState(1_000, true)
    await act(async () => {
      root.render(createElement(MobileSourceControlFileList, { state }))
    })
    const firstRow = container.querySelector(
      '[aria-label="Open committed change src/committed-0.ts"]'
    )
    const textNode = (text: string) => {
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
    const swatch = document.createElement('span')
    document.body.append(swatch)
    try {
      for (const scheme of ['light', 'dark', 'light'] as const) {
        await act(async () => applyMobileColorScheme(scheme))
        const palette = scheme === 'light' ? lightColors : darkColors
        for (const text of ['Changes', 'Committed on Branch', 'src/committed-0.ts']) {
          swatch.style.color =
            text === 'src/committed-0.ts' ? palette.textPrimary : palette.textSecondary
          expect(processColor(getComputedStyle(textNode(text)).color)).toBe(
            processColor(swatch.style.color)
          )
        }
        expect(
          container.querySelector('[aria-label="Open committed change src/committed-0.ts"]')
        ).toBe(firstRow)
        expect(
          container.querySelectorAll('[aria-label^="Open committed change "]').length
        ).toBeLessThan(50)
      }
      if (!(firstRow instanceof HTMLElement)) {
        throw new Error('Missing committed row')
      }
      await act(async () => firstRow.click())
      expect(state.openBranchDiff).toHaveBeenCalledExactlyOnceWith(state.branchEntries[0])
    } finally {
      swatch.remove()
    }
  })

  it.each([false, true])(
    'bounds mounted committed rows as the branch grows (dirty: %s)',
    async (dirty) => {
      const mountedCounts: number[] = []
      for (const count of [1_000, 20_000]) {
        const state = fileListState(count, dirty)
        await act(async () => {
          root.render(createElement(MobileSourceControlFileList, { key: count, state }))
        })
        const rows = container.querySelectorAll('[aria-label^="Open committed change "]')
        mountedCounts.push(rows.length)
        expect(rows.length).toBeGreaterThan(0)
        expect(rows.length).toBeLessThan(50)
        expect(container.textContent).toContain(`${count} files vs main`)
        expect(
          container.querySelector('[aria-label="Open committed change src/committed-999.ts"]')
        ).toBeNull()
        if (dirty) {
          expect(
            container.querySelector('[aria-label="Open changed file src/uncommitted.ts"]')
          ).not.toBeNull()
        }
        const first = rows.item(0)
        if (!(first instanceof HTMLElement)) {
          throw new Error('No committed change mounted')
        }
        await act(async () => first.click())
        expect(state.openBranchDiff).toHaveBeenCalledExactlyOnceWith(state.branchEntries[0])
      }
      expect(mountedCounts[1]).toBe(mountedCounts[0])
    }
  )
})
