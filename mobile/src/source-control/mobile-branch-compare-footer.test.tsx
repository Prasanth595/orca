import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BranchCompareFooter, MAX_VISIBLE_BRANCH_ENTRIES } from './MobileSourceControlFileRows'
import type { MobileSourceControlState } from './use-mobile-source-control-state'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View'
}))

vi.mock('lucide-react-native', () => ({
  ArrowDown: 'ArrowDown',
  ArrowDownUp: 'ArrowDownUp',
  ArrowUp: 'ArrowUp',
  Check: 'Check',
  ChevronRight: 'ChevronRight',
  CloudUpload: 'CloudUpload',
  FileText: 'FileText',
  GitBranch: 'GitBranch',
  GitPullRequestArrow: 'GitPullRequestArrow',
  History: 'History',
  Minus: 'Minus',
  Plus: 'Plus',
  RefreshCw: 'RefreshCw',
  Trash2: 'Trash2'
}))

type FooterState = Parameters<typeof BranchCompareFooter>[0]['state']

const noopAsync = async (): Promise<void> => {}

function footerState(count: number): FooterState {
  const branchEntries: MobileSourceControlState['branchEntries'] = Array.from(
    { length: count },
    (_, index) => ({
      path: `src/file-${index}.ts`,
      status: 'modified' as const,
      canOpen: true
    })
  )
  const branchCompareResult = {
    entries: branchEntries,
    summary: {
      status: 'ready' as const,
      baseRef: 'main',
      changedFiles: count,
      commitsAhead: undefined,
      errorMessage: undefined
    }
  }
  return {
    shouldShowBranchCompareSection: true,
    branchCompareSummaryText: `${count} files vs main`,
    branchEntries,
    branchCompareState: { kind: 'ready', result: branchCompareResult },
    branchCompareResult,
    busyAction: null,
    openBranchDiff: noopAsync,
    openingBranchPath: null,
    openingPath: null
  }
}

function committedRows(rendered: ReactTestRenderer) {
  return rendered.root.findAll(
    (node) =>
      String(node.type) === 'Pressable' &&
      typeof node.props.accessibilityLabel === 'string' &&
      node.props.accessibilityLabel.startsWith('Open committed change')
  )
}

describe('BranchCompareFooter committed file cap', () => {
  let tree: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => tree?.unmount())
    tree = null
  })

  function render(count: number) {
    act(() => {
      tree = create(createElement(BranchCompareFooter, { state: footerState(count) }))
    })
    if (tree === null) {
      throw new Error('footer did not render')
    }
    return tree
  }

  it('caps rendered committed files and names the remainder', () => {
    const count = MAX_VISIBLE_BRANCH_ENTRIES + 50
    const rendered = render(count)
    const rows = committedRows(rendered)
    expect(rows).toHaveLength(MAX_VISIBLE_BRANCH_ENTRIES)
    expect(rows[0]?.props.accessibilityLabel).toBe('Open committed change src/file-0.ts')
    expect(rows.at(-1)?.props.accessibilityLabel).toBe(
      `Open committed change src/file-${MAX_VISIBLE_BRANCH_ENTRIES - 1}.ts`
    )
    expect(JSON.stringify(rendered.toJSON())).toContain(
      `Showing first ${MAX_VISIBLE_BRANCH_ENTRIES} of ${count} committed files. View all in desktop.`
    )
    expect(JSON.stringify(rendered.toJSON())).not.toContain(
      `Open committed change src/file-${MAX_VISIBLE_BRANCH_ENTRIES}.ts`
    )
  })

  it('renders every committed file when the list is within the cap', () => {
    const rendered = render(MAX_VISIBLE_BRANCH_ENTRIES)
    expect(committedRows(rendered)).toHaveLength(MAX_VISIBLE_BRANCH_ENTRIES)
    expect(JSON.stringify(rendered.toJSON())).not.toContain('View all in desktop.')
  })
})
