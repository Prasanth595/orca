import { Button } from '../ui/button'
import { translate } from '@/i18n/i18n'
import type { WorkspaceGridViewCellRect } from '@/lib/workspace-grid-view-cell-rects'
import { focusWorkspaceGridViewMember } from '@/lib/workspace-grid-view-actions'
import { WorkspaceGridViewCellHeader } from './WorkspaceGridViewCellHeader'
import {
  workspaceGridViewCellClassName,
  workspaceGridViewCellStyle,
  workspaceGridViewCellWindowCorners
} from './workspace-grid-view-cell-frame'

/** A grid view member with no tab layout yet, e.g. a workspace added before it was ever opened. */
export function WorkspaceGridViewEmptyCell({
  workspaceId,
  workspacePath,
  rect
}: {
  workspaceId: string
  workspacePath: string
  rect: WorkspaceGridViewCellRect
}): React.JSX.Element {
  return (
    <div
      className={workspaceGridViewCellClassName(rect)}
      style={workspaceGridViewCellStyle(rect)}
      data-workspace-grid-view-cell={workspaceId}
    >
      <WorkspaceGridViewCellHeader
        workspaceId={workspaceId}
        workspacePath={workspacePath}
        isFocused={false}
        windowCorners={workspaceGridViewCellWindowCorners(rect)}
      />
      <div className="flex flex-1 items-center justify-center bg-background">
        <Button
          variant="outline"
          size="sm"
          onClick={() => focusWorkspaceGridViewMember(workspaceId)}
        >
          {translate(
            'auto.components.workspace-grid-view.WorkspaceGridViewEmptyCell.openWorkspace',
            'Open Workspace'
          )}
        </Button>
      </div>
    </div>
  )
}
