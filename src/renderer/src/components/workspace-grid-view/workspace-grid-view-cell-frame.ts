import type { CSSProperties, PointerEvent } from 'react'
import { cn } from '@/lib/utils'
import {
  workspaceGridViewCellEdges,
  type WorkspaceGridViewCellRect
} from '@/lib/workspace-grid-view-cell-rects'
import { focusWorkspaceGridViewMember } from '@/lib/workspace-grid-view-actions'

/** Marks controls inside a cell that act on the grid view instead of focusing the cell. */
export const WORKSPACE_GRID_VIEW_CELL_ACTION_ATTR = 'data-workspace-grid-view-cell-action'

export function workspaceGridViewCellStyle(rect: WorkspaceGridViewCellRect): CSSProperties {
  return {
    left: `${rect.left}%`,
    top: `${rect.top}%`,
    width: `${rect.width}%`,
    height: `${rect.height}%`
  }
}

/** One hairline between neighbours: cells paint only their inner right and bottom seams. */
export function workspaceGridViewCellClassName(rect: WorkspaceGridViewCellRect): string {
  const edges = workspaceGridViewCellEdges(rect)
  return cn(
    'absolute flex pt-7',
    !edges.right && 'border-r border-border',
    !edges.bottom && 'border-b border-border'
  )
}

/** Which window corners the cell's header shares with the floating sidebar toggles and window controls. */
export function workspaceGridViewCellWindowCorners(rect: WorkspaceGridViewCellRect): {
  topLeft: boolean
  topRight: boolean
} {
  const edges = workspaceGridViewCellEdges(rect)
  return { topLeft: edges.top && edges.left, topRight: edges.top && edges.right }
}

export function focusWorkspaceGridViewCellOnPointerDown(
  event: PointerEvent<HTMLElement>,
  workspaceId: string
): void {
  if (
    event.target instanceof Element &&
    event.target.closest(`[${WORKSPACE_GRID_VIEW_CELL_ACTION_ATTR}]`)
  ) {
    return
  }
  focusWorkspaceGridViewMember(workspaceId)
}
