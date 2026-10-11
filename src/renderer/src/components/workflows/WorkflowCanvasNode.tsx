import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { NODE_TYPE_LABELS, NODE_TYPE_COLORS, nodeLabel } from './workflow-canvas-node-config'
import type { WorkflowNode } from '../../../../shared/workflow-types'

type Props = {
  node: WorkflowNode
  effectiveX: number
  effectiveY: number
  isSelected: boolean
  isConnecting: boolean
  isConnectingFrom: boolean
  onMouseDown: (e: React.MouseEvent, nodeId: string) => void
  onNodeClick: (nodeId: string) => void
  onContextMenu: (nodeId: string) => void
  onDelete: (nodeId: string, e: React.MouseEvent) => void
  onConnectStart: (nodeId: string) => void
}

export default function WorkflowCanvasNode({
  node,
  effectiveX,
  effectiveY,
  isSelected,
  isConnecting,
  isConnectingFrom,
  onMouseDown,
  onNodeClick,
  onContextMenu,
  onDelete,
  onConnectStart
}: Props): React.JSX.Element {
  return (
    <div
      id={`wf-node-${node.id}`}
      className={cn(
        'absolute select-none rounded-lg border-2 px-3 py-2 shadow-sm transition-shadow min-w-[160px] group z-[1]',
        isConnecting ? 'cursor-crosshair' : 'cursor-move',
        NODE_TYPE_COLORS[node.type],
        isSelected && 'ring-2 ring-primary ring-offset-1',
        isConnectingFrom && 'ring-2 ring-primary ring-offset-2 opacity-60'
      )}
      style={{ left: effectiveX, top: effectiveY }}
      onMouseDown={(e) => {
        if (!isConnecting) {
          onMouseDown(e, node.id)
        } else {
          e.stopPropagation()
        }
      }}
      onClick={(e) => {
        e.stopPropagation()
        onNodeClick(node.id)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onContextMenu(node.id)
      }}
    >
      {/* Delete button — top-right */}
      <button
        type="button"
        className="absolute -top-2 -right-2 size-4 rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow-sm z-10"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => onDelete(node.id, e)}
        title={translate('workflows.canvas.deleteNode', 'Delete node')}
      >
        <X className="size-2.5" />
      </button>
      {/* Port handle — right-center, starts connection on click */}
      {!isConnecting && (
        <button
          type="button"
          className="absolute right-[-7px] top-1/2 -translate-y-1/2 size-3.5 rounded-full border-2 border-border bg-background hover:border-primary hover:bg-primary/10 opacity-0 group-hover:opacity-100 transition-all z-10 flex items-center justify-center shadow-sm"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onConnectStart(node.id)
          }}
          title={translate('workflows.canvas.connectPort', 'Connect from this node')}
        />
      )}
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
        {NODE_TYPE_LABELS[node.type]}
      </div>
      <div className="text-[12px] font-medium truncate max-w-[140px]">{nodeLabel(node)}</div>
    </div>
  )
}
