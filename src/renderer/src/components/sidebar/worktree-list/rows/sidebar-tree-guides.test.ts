import { describe, expect, it } from 'vitest'
import type { RenderRow } from '../listing/render-row'
import { getSidebarTreeGuideSpec } from './sidebar-tree-guides'

function item(sectionKey: string, groupDepth: number): RenderRow {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: getSidebarTreeGuideSpec reads only type, sectionKey and groupDepth.
  return { type: 'item', sectionKey, groupDepth } as unknown as RenderRow
}

function header(projectGroupDepth: number): RenderRow {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: getSidebarTreeGuideSpec reads only type and projectGroupDepth.
  return { type: 'header', key: 'h', projectGroupDepth } as unknown as RenderRow
}

describe('getSidebarTreeGuideSpec', () => {
  const rows = [header(0), header(1), item('repo:a', 1), item('repo:a', 1), header(1)]

  it('draws one group guide per enclosing group on nested rows', () => {
    expect(getSidebarTreeGuideSpec({ rows, index: 1, groupBy: 'repo' })).toEqual({
      groupLevels: 1,
      branch: null
    })
  })

  it('hangs worktrees off the section line, cornering only the last one', () => {
    // Nested project label column (10 + 16 + 6) plus 4px.
    const left = 36
    expect(getSidebarTreeGuideSpec({ rows, index: 2, groupBy: 'repo' })?.branch).toEqual({
      left,
      isLast: false
    })
    expect(getSidebarTreeGuideSpec({ rows, index: 3, groupBy: 'repo' })?.branch).toEqual({
      left,
      isLast: true
    })
  })

  it('draws nothing for a top-level header or an ungrouped flat list', () => {
    expect(getSidebarTreeGuideSpec({ rows, index: 0, groupBy: 'repo' })).toBeNull()
    expect(
      getSidebarTreeGuideSpec({ rows: [item('all', 0)], index: 0, groupBy: 'none' })
    ).toBeNull()
  })
})
