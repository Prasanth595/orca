import React from 'react'
import type { VirtualItem } from '@tanstack/react-virtual'
import type { RenderRow } from '../listing/render-row'
import type { WorktreeGroupBy } from '../grouping/row-types'
import { getVirtualRowTransform, WORKTREE_SIDEBAR_VIRTUAL_ROW_GAP } from '../viewport/virtual-rows'
import {
  getHierarchyWorktreeTreeLeft,
  getProjectGroupGuideLeft,
  HIERARCHY_TREE_TICK_TOP,
  HIERARCHY_TREE_TICK_WIDTH,
  MAX_PROJECT_GROUP_HEADER_DEPTH
} from './indentation'

type WorktreeBranch = { left: number; isLast: boolean }

export type SidebarTreeGuideSpec = {
  /** Enclosing project groups; each draws one full-height guide. */
  groupLevels: number
  /** Worktree rows hang off their section's tree line with a tick. */
  branch: WorktreeBranch | null
}

/** Number of enclosing project groups for a row. */
export function getProjectGroupGuideDepth(row: RenderRow): number {
  switch (row.type) {
    case 'header':
      return row.projectGroupDepth ?? 0
    case 'item':
    case 'folder-workspace':
      return row.groupDepth
    case 'lineage-group':
      return row.rows[0]?.groupDepth ?? 0
    case 'imported-worktrees-card':
    case 'new-external-worktrees-inbox':
    case 'pending-creation':
      return row.groupDepth ?? 0
    case 'host-header':
      return 0
  }
}

function getWorktreeSectionKey(row: RenderRow | undefined): string | null {
  if (row?.type === 'item') {
    return row.sectionKey
  }
  if (row?.type === 'lineage-group') {
    return row.rows[0]?.sectionKey ?? null
  }
  return null
}

export function getSidebarTreeGuideSpec(args: {
  rows: readonly RenderRow[]
  index: number
  groupBy: WorktreeGroupBy
}): SidebarTreeGuideSpec | null {
  const row = args.rows[args.index]
  if (!row) {
    return null
  }
  const depth = getProjectGroupGuideDepth(row)
  const groupLevels = Math.min(depth, MAX_PROJECT_GROUP_HEADER_DEPTH)
  const sectionKey = args.groupBy === 'none' ? null : getWorktreeSectionKey(row)
  const branch =
    sectionKey === null
      ? null
      : {
          left: getHierarchyWorktreeTreeLeft(depth),
          isLast: getWorktreeSectionKey(args.rows[args.index + 1]) !== sectionKey
        }
  return groupLevels > 0 || branch ? { groupLevels, branch } : null
}

const GAP = WORKTREE_SIDEBAR_VIRTUAL_ROW_GAP

// Why: the list is virtualized, so each slot draws its own segments; they overlap by the
// inter-row gap and use an opaque color, so stacked slots read as one unbroken line.
export function renderSidebarTreeGuides(
  vItem: VirtualItem,
  spec: SidebarTreeGuideSpec
): React.JSX.Element {
  const { branch } = spec
  return (
    <div
      key={`guides:${String(vItem.key)}`}
      aria-hidden
      data-worktree-tree-guides=""
      className="pointer-events-none absolute left-0 top-0 w-0"
      style={{ transform: getVirtualRowTransform(vItem.start), height: vItem.size + GAP }}
    >
      {Array.from({ length: spec.groupLevels }, (_, level) => (
        <span
          key={level}
          className="worktree-sidebar-group-guide absolute inset-y-0 w-0.5"
          style={{ left: getProjectGroupGuideLeft(level) }}
        />
      ))}
      {branch ? (
        <>
          {/* Vertical: from the gap above down to the tick (last) or through the gap below. */}
          <span
            className="worktree-sidebar-tree-guide absolute w-px"
            style={{
              left: branch.left,
              top: -GAP,
              height: branch.isLast ? GAP + HIERARCHY_TREE_TICK_TOP + 1 : vItem.size + 2 * GAP
            }}
          />
          <span
            className="worktree-sidebar-tree-guide absolute h-px"
            style={{
              left: branch.left + 1,
              top: HIERARCHY_TREE_TICK_TOP,
              width: HIERARCHY_TREE_TICK_WIDTH
            }}
          />
        </>
      ) : null}
    </div>
  )
}
