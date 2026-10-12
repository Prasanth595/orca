import { useState } from 'react'
import { getPortYOffset } from './workflow-canvas-node-config'
import type { AgentWorkflow } from '../../../../shared/workflow-types'

const CANVAS_W = 4000
const CANVAS_H = 3000
const NODE_W = 160

type Props = {
  nodes: AgentWorkflow['nodes']
  edges: AgentWorkflow['edges']
  draggingPos: { nodeId: string; x: number; y: number } | null
  onDeleteEdge: (edgeId: string) => void
}

export default function WorkflowCanvasEdgesLayer({
  nodes,
  edges,
  draggingPos,
  onDeleteEdge
}: Props): React.JSX.Element {
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null)

  function ep(nodeId: string, stored: { x: number; y: number }): { x: number; y: number } {
    return draggingPos?.nodeId === nodeId ? { x: draggingPos.x, y: draggingPos.y } : stored
  }
  return (
    <svg
      className="absolute inset-0"
      style={{ width: CANVAS_W, height: CANVAS_H, pointerEvents: 'none' }}
    >
      {edges.map((edge) => {
        const src = nodes.find((n) => n.id === edge.sourceNodeId)
        const tgt = nodes.find((n) => n.id === edge.targetNodeId)
        if (!src || !tgt) {
          return null
        }
        const sp = ep(src.id, src.pos)
        const tp = ep(tgt.id, tgt.pos)
        const x1 = sp.x + NODE_W
        const y1 = sp.y + getPortYOffset(src, edge.outputSelector)
        const x2 = tp.x
        const y2 = tp.y + getPortYOffset(tgt, undefined)
        const cp = Math.max(60, Math.abs(x2 - x1) / 2)
        const d = `M${x1},${y1} C${x1 + cp},${y1} ${x2 - cp},${y2} ${x2},${y2}`
        // Midpoint of this symmetric bezier = average of endpoints
        const midX = (x1 + x2) / 2
        const midY = (y1 + y2) / 2
        const isHovered = hoveredEdgeId === edge.id

        return (
          <g
            key={edge.id}
            style={{ pointerEvents: 'all' }}
            onMouseEnter={() => setHoveredEdgeId(edge.id)}
            onMouseLeave={() => setHoveredEdgeId(null)}
          >
            {/* Wide transparent hit area */}
            <path d={d} fill="none" stroke="transparent" strokeWidth={12} />
            {/* Visible path */}
            <path
              d={d}
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeDasharray="6 3"
              strokeLinecap="round"
              className={
                isHovered
                  ? 'text-destructive/60 transition-colors'
                  : 'text-foreground/60 transition-colors'
              }
            />
            {/* Delete badge — only shown on hover */}
            {isHovered && (
              <g
                transform={`translate(${midX}, ${midY})`}
                className="text-destructive cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation()
                  onDeleteEdge(edge.id)
                }}
              >
                <circle r={9} fill="currentColor" />
                <line
                  x1="-4"
                  y1="-4"
                  x2="4"
                  y2="4"
                  stroke="var(--color-background)"
                  strokeWidth={1.75}
                  strokeLinecap="round"
                />
                <line
                  x1="4"
                  y1="-4"
                  x2="-4"
                  y2="4"
                  stroke="var(--color-background)"
                  strokeWidth={1.75}
                  strokeLinecap="round"
                />
              </g>
            )}
          </g>
        )
      })}
    </svg>
  )
}
