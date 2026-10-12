import { X, Loader2, CheckCircle2, XCircle, SkipForward } from 'lucide-react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import {
  NODE_TYPE_LABELS,
  NODE_TYPE_COLORS,
  nodeLabel,
  getOutputPorts,
  PORT_Y_BASE,
  PORT_ROW_H,
  SINGLE_PORT_MID
} from './workflow-canvas-node-config'
import type { WorkflowNode, WorkflowNodeRunStatus } from '../../../../shared/workflow-types'

type Props = {
  node: WorkflowNode
  effectiveX: number
  effectiveY: number
  isSelected: boolean
  isConnecting: boolean
  isConnectingFrom: boolean
  runStatus?: WorkflowNodeRunStatus
  onMouseDown: (e: React.MouseEvent, nodeId: string) => void
  onNodeClick: (nodeId: string) => void
  onContextMenu: (nodeId: string) => void
  onDelete: (nodeId: string, e: React.MouseEvent) => void
  onConnectStart: (nodeId: string, outputSelector?: string) => void
}

function RunStatusBadge({ status }: { status: WorkflowNodeRunStatus }): React.JSX.Element | null {
  switch (status) {
    case 'running':
      return <Loader2 className="size-3 animate-spin text-status-warning" />
    case 'completed':
      return <CheckCircle2 className="size-3 text-status-success" />
    case 'failed':
      return <XCircle className="size-3 text-destructive" />
    case 'skipped':
      return <SkipForward className="size-3 text-muted-foreground" />
    default:
      return null
  }
}

export default function WorkflowCanvasNode({
  node,
  effectiveX,
  effectiveY,
  isSelected,
  isConnecting,
  isConnectingFrom,
  runStatus,
  onMouseDown,
  onNodeClick,
  onContextMenu,
  onDelete,
  onConnectStart
}: Props): React.JSX.Element {
  const ports = getOutputPorts(node)
  const isMultiPort = ports.length > 1
  const inputY = isMultiPort ? PORT_Y_BASE / 2 : SINGLE_PORT_MID

  return (
    <div
      id={`wf-node-${node.id}`}
      className={cn(
        'absolute select-none rounded-lg border-2 shadow-sm transition-shadow min-w-[160px] group z-[1] overflow-visible',
        isConnecting ? 'cursor-crosshair' : 'cursor-move',
        NODE_TYPE_COLORS[node.type],
        runStatus === 'running' && 'ring-2 ring-status-warning ring-offset-2',
        runStatus === 'completed' && 'ring-2 ring-status-success ring-offset-1',
        runStatus === 'failed' && 'ring-2 ring-destructive ring-offset-1',
        runStatus === 'skipped' && 'opacity-50',
        !runStatus && isSelected && 'ring-2 ring-primary ring-offset-1',
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
      {/* Delete button — top-right, hidden until hover */}
      <button
        type="button"
        className="absolute -top-2 -right-2 size-4 rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow-sm z-10"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => onDelete(node.id, e)}
        title={translate('workflows.canvas.deleteNode', 'Delete node')}
      >
        <X className="size-2.5" />
      </button>

      {/* Run status badge — top-right corner, outside node boundary */}
      {runStatus && runStatus !== 'pending' && (
        <div className="absolute -top-2 -right-2 bg-background rounded-full p-0.5 shadow-sm z-10 border border-border/40 pointer-events-none">
          <RunStatusBadge status={runStatus} />
        </div>
      )}

      {/* Input port — left side, visual only */}
      <div
        className="absolute left-[-7px] size-3 rounded-full border-2 border-border bg-background shadow-sm"
        style={{ top: inputY, transform: 'translateY(-50%)' }}
      />

      {/* Node header */}
      <div className="px-3 pt-2 pb-1">
        <div className="flex items-center justify-between gap-1 mb-0.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {NODE_TYPE_LABELS[node.type]}
          </div>
          {runStatus === 'skipped' && (
            <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/80 bg-muted px-1.5 py-px rounded shrink-0">
              {translate('workflows.run.skipped', 'Skipped')}
            </span>
          )}
          {runStatus === 'running' && (
            <span className="text-[9px] font-semibold text-status-warning shrink-0">
              {translate('workflows.run.running', 'Running…')}
            </span>
          )}
        </div>
        <div className="text-[12px] font-medium truncate max-w-[140px]">{nodeLabel(node)}</div>
      </div>

      {/* Output ports */}
      {isMultiPort ? (
        <div className="border-t border-border/40 pb-1">
          {ports.map((port) => (
            <div
              key={port.selector ?? '__default__'}
              className="relative flex items-center justify-end pr-4 pl-3"
              style={{ height: PORT_ROW_H }}
            >
              <span className="text-[10px] text-muted-foreground">{port.label}</span>
              {!isConnecting && (
                <button
                  type="button"
                  className="absolute right-[-7px] top-1/2 -translate-y-1/2 size-3.5 rounded-full border-2 border-border bg-background hover:border-primary hover:bg-primary/10 transition-all z-10 shadow-sm"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    onConnectStart(node.id, port.selector)
                  }}
                  title={translate('workflows.canvas.connectPort', `Connect from "${port.label}"`)}
                />
              )}
            </div>
          ))}
        </div>
      ) : (
        /* Single port — right-center, appears on hover */
        !isConnecting && (
          <button
            type="button"
            className="absolute right-[-7px] top-1/2 -translate-y-1/2 size-3.5 rounded-full border-2 border-border bg-background hover:border-primary hover:bg-primary/10 opacity-0 group-hover:opacity-100 transition-all z-10 flex items-center justify-center shadow-sm"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onConnectStart(node.id, undefined)
            }}
            title={translate('workflows.canvas.connectPort', 'Connect from this node')}
          />
        )
      )}
    </div>
  )
}
