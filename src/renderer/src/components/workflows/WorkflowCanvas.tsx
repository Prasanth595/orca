import { useState, useRef, useEffect, useMemo } from 'react'
import { Maximize2, Minimize2, Plus, Workflow, Play, Loader2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { buildDefaultNode } from './workflow-canvas-node-config'
import { usePersistedCanvasPan } from '@/hooks/use-persisted-canvas-pan'
import WorkflowCanvasEdgesLayer from './WorkflowCanvasEdgesLayer'
import WorkflowAddNodeMenu from './WorkflowAddNodeMenu'
import WorkflowCanvasNode from './WorkflowCanvasNode'
import WorkflowExecutionTargetBadge from './WorkflowExecutionTargetBadge'
import { validateWorkflow } from '../../../../shared/workflow-graph-validation'
import type { AgentWorkflow, WorkflowNodeType } from '../../../../shared/workflow-types'

const CANVAS_W = 4000
const CANVAS_H = 3000

type Props = {
  workflow: AgentWorkflow | null
  focused: boolean
  onFocus: () => void
  onUnfocus: () => void
  onNodeSelect: (nodeId: string | null) => void
  selectedNodeId: string | null
}

export default function WorkflowCanvas({
  workflow,
  focused,
  onFocus,
  onUnfocus,
  onNodeSelect,
  selectedNodeId
}: Props): React.JSX.Element {
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null)
  const [draggingPos, setDraggingPos] = useState<{ nodeId: string; x: number; y: number } | null>(
    null
  )
  const [isPanning, setIsPanning] = useState(false)
  const [isRunning, setIsRunning] = useState(false)

  const dragRef = useRef<{
    nodeId: string
    startX: number
    startY: number
    origX: number
    origY: number
  } | null>(null)
  // Set to true when a node drag moves enough to count as a drag (not a click)
  const didDragNodeRef = useRef(false)
  const panDragRef = useRef<{
    startX: number
    startY: number
    origX: number
    origY: number
  } | null>(null)
  // Tracks whether the last mousedown resulted in an actual pan (moved > 2px)
  const didPanRef = useRef(false)
  const viewportRef = useRef<HTMLDivElement>(null)

  const [pan, setPan, persistPan] = usePersistedCanvasPan(workflow?.id ?? '')

  const validationErrors = useMemo(() => (workflow ? validateWorkflow(workflow) : []), [workflow])
  const hasCycleError = validationErrors.some((e) => e.kind === 'cycle')

  useEffect(() => {
    if (!connectingFrom) {
      return
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setConnectingFrom(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [connectingFrom])

  useEffect(() => {
    if (!workflow) {
      return
    }
    return window.api.workflows.onRunUpdated(({ workflowId: wid, run }) => {
      if (wid !== workflow.id) {
        return
      }
      setIsRunning(run.status === 'running')
    })
  }, [workflow])

  if (workflow === null) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
        <Workflow className="size-8 opacity-30" strokeWidth={1.25} />
        <span className="text-[13px]">
          {translate('workflows.canvas.empty', 'Select or create a workflow to start editing.')}
        </span>
      </div>
    )
  }

  async function connectNodes(sourceId: string, targetId: string): Promise<void> {
    if (!workflow || sourceId === targetId) {
      return
    }
    const alreadyExists = workflow.edges.some(
      (e) => e.sourceNodeId === sourceId && e.targetNodeId === targetId
    )
    if (alreadyExists) {
      return
    }
    await window.api.workflows.update(workflow.id, {
      edges: [
        ...workflow.edges,
        { id: createBrowserUuid(), sourceNodeId: sourceId, targetNodeId: targetId }
      ]
    })
  }

  async function deleteEdge(edgeId: string): Promise<void> {
    if (!workflow) {
      return
    }
    await window.api.workflows.update(workflow.id, {
      edges: workflow.edges.filter((e) => e.id !== edgeId)
    })
  }

  async function deleteNode(nodeId: string, e: React.MouseEvent): Promise<void> {
    e.stopPropagation()
    if (!workflow) {
      return
    }
    await window.api.workflows.update(workflow.id, {
      nodes: workflow.nodes.filter((n) => n.id !== nodeId),
      edges: workflow.edges.filter(
        (edge) => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId
      )
    })
    if (selectedNodeId === nodeId) {
      onNodeSelect(null)
    }
  }

  async function handleRun(): Promise<void> {
    if (!workflow || isRunning || hasCycleError) {
      return
    }
    await window.api.workflows.runNow(workflow.id)
  }

  async function addNode(type: WorkflowNodeType): Promise<void> {
    if (!workflow) {
      return
    }
    setShowAddMenu(false)
    const id = createBrowserUuid()
    const vpW = viewportRef.current?.clientWidth ?? 600
    const vpH = viewportRef.current?.clientHeight ?? 400
    // Place in the visible center area of the canvas
    const centerX = -pan.x + vpW / 2 - 80
    const centerY = -pan.y + vpH / 2 - 24
    const pos = {
      x: Math.max(0, centerX + (workflow.nodes.length % 5) * 180 - 360),
      y: Math.max(0, centerY)
    }
    const newNode = buildDefaultNode(id, type, pos)
    await window.api.workflows.update(workflow.id, {
      nodes: [...workflow.nodes, newNode]
    })
  }

  function handleNodeMouseDown(e: React.MouseEvent, nodeId: string): void {
    e.stopPropagation()
    const node = workflow?.nodes.find((n) => n.id === nodeId)
    if (!node) {
      return
    }
    dragRef.current = {
      nodeId,
      startX: e.clientX,
      startY: e.clientY,
      origX: node.pos.x,
      origY: node.pos.y
    }
    let rafId = 0
    const onMouseMove = (ev: MouseEvent): void => {
      if (!dragRef.current) {
        return
      }
      const dx = ev.clientX - dragRef.current.startX
      const dy = ev.clientY - dragRef.current.startY
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        didDragNodeRef.current = true
      }
      cancelAnimationFrame(rafId)
      const snap = { ...dragRef.current, clientX: ev.clientX, clientY: ev.clientY }
      rafId = requestAnimationFrame(() => {
        const sdx = snap.clientX - snap.startX
        const sdy = snap.clientY - snap.startY
        setDraggingPos({ nodeId: snap.nodeId, x: snap.origX + sdx, y: snap.origY + sdy })
      })
    }
    const onMouseUp = async (ev: MouseEvent): Promise<void> => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      if (!dragRef.current || !workflow) {
        setDraggingPos(null)
        return
      }
      const dx = ev.clientX - dragRef.current.startX
      const dy = ev.clientY - dragRef.current.startY
      const newPos = { x: dragRef.current.origX + dx, y: dragRef.current.origY + dy }
      dragRef.current = null
      // Hold draggingPos until IPC update resolves to prevent position flash
      await window.api.workflows.update(workflow.id, {
        nodes: workflow.nodes.map((n) => (n.id === nodeId ? { ...n, pos: newPos } : n))
      })
      setDraggingPos(null)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  function handleViewportMouseDown(e: React.MouseEvent<HTMLDivElement>): void {
    if (e.button !== 0 || connectingFrom) {
      return
    }
    didPanRef.current = false
    panDragRef.current = { startX: e.clientX, startY: e.clientY, origX: pan.x, origY: pan.y }

    let rafId = 0
    const onMouseMove = (ev: MouseEvent): void => {
      if (!panDragRef.current) {
        return
      }
      const { startX, startY, origX, origY } = panDragRef.current
      const mx = ev.clientX
      const my = ev.clientY
      if (Math.abs(mx - startX) > 2 || Math.abs(my - startY) > 2) {
        didPanRef.current = true
        setIsPanning(true)
      }
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        setPan({ x: origX + (mx - startX), y: origY + (my - startY) })
      })
    }

    const onMouseUp = (ev: MouseEvent): void => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      if (panDragRef.current) {
        const { startX, startY, origX, origY } = panDragRef.current
        setPan({ x: origX + (ev.clientX - startX), y: origY + (ev.clientY - startY) })
        panDragRef.current = null
        persistPan()
      }
      setIsPanning(false)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  const nodePositions: Record<string, { x: number; y: number }> = {}
  for (const node of workflow.nodes) {
    nodePositions[node.id] = node.pos
  }

  return (
    <div
      ref={viewportRef}
      className={cn(
        'relative h-full w-full overflow-hidden bg-muted/10 select-none',
        connectingFrom ? 'cursor-crosshair' : isPanning ? 'cursor-grabbing' : 'cursor-grab'
      )}
      onMouseDown={handleViewportMouseDown}
    >
      {/* Execution target badge — viewport overlay, top left */}
      <div className="absolute top-2 left-2 z-10" onMouseDown={(e) => e.stopPropagation()}>
        <WorkflowExecutionTargetBadge workflow={workflow} />
      </div>

      {/* Focus toggle — viewport overlay, top right */}
      <div className="absolute top-2 right-2 z-10">
        <Button
          size="icon"
          variant="outline"
          className="size-7"
          onClick={focused ? onUnfocus : onFocus}
          onMouseDown={(e) => e.stopPropagation()}
          title={
            focused
              ? translate('workflows.canvas.exitFocus', 'Exit focus')
              : translate('workflows.canvas.focusCanvas', 'Focus canvas')
          }
        >
          {focused ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        </Button>
      </div>

      {/* Connect mode hint — viewport overlay, top center */}
      {connectingFrom && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 bg-primary text-primary-foreground text-[11px] px-2 py-1 rounded shadow pointer-events-none">
          {translate(
            'workflows.canvas.connectHint',
            'Click a target node to connect — Esc to cancel'
          )}
        </div>
      )}

      {/* Panned canvas layer */}
      <div
        className="absolute top-0 left-0"
        style={{
          width: CANVAS_W,
          height: CANVAS_H,
          transform: `translate(${pan.x}px, ${pan.y}px)`
        }}
        onClick={(e) => {
          if (didPanRef.current) {
            return
          }
          if (connectingFrom) {
            setConnectingFrom(null)
            return
          }
          if (e.target === e.currentTarget) {
            onNodeSelect(null)
            setShowAddMenu(false)
          }
        }}
      >
        <WorkflowCanvasEdgesLayer
          workflowId={workflow.id}
          nodes={workflow.nodes}
          edges={workflow.edges}
          draggingPos={draggingPos}
          nodePositions={nodePositions}
          onDeleteEdge={(id) => void deleteEdge(id)}
        />
        {workflow.nodes.map((node) => (
          <WorkflowCanvasNode
            key={node.id}
            node={node}
            effectiveX={draggingPos?.nodeId === node.id ? draggingPos.x : node.pos.x}
            effectiveY={draggingPos?.nodeId === node.id ? draggingPos.y : node.pos.y}
            isSelected={selectedNodeId === node.id}
            isConnecting={connectingFrom !== null}
            isConnectingFrom={connectingFrom === node.id}
            onMouseDown={handleNodeMouseDown}
            onNodeClick={(nodeId) => {
              if (didDragNodeRef.current) {
                didDragNodeRef.current = false
                return
              }
              if (connectingFrom) {
                void connectNodes(connectingFrom, nodeId)
                setConnectingFrom(null)
              } else {
                onNodeSelect(nodeId)
              }
            }}
            onContextMenu={(nodeId) => {
              setConnectingFrom(nodeId)
              setShowAddMenu(false)
            }}
            onConnectStart={(nodeId) => {
              setConnectingFrom(nodeId)
              setShowAddMenu(false)
            }}
            onDelete={deleteNode}
          />
        ))}
      </div>

      {workflow.nodes.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground/50 pointer-events-none">
          <span className="text-[13px]">
            {translate('workflows.canvas.addNode', 'Click + to add nodes')}
          </span>
        </div>
      )}
      {showAddMenu && <WorkflowAddNodeMenu onAdd={(type) => void addNode(type)} />}

      {/* Run + Add node buttons — bottom center */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2">
        <div className="relative" onMouseDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={cn(
              'flex items-center justify-center size-8 rounded-full border border-border bg-background text-foreground shadow-md transition-colors',
              isRunning || hasCycleError ? 'opacity-60 cursor-not-allowed' : 'hover:bg-accent'
            )}
            onClick={() => void handleRun()}
            disabled={isRunning || hasCycleError}
            title={
              hasCycleError
                ? translate('workflows.canvas.runBlockedCycle', 'Fix cycle error to run')
                : validationErrors.length > 0
                  ? `${validationErrors.length} ${translate('workflows.canvas.runWarnings', 'warning(s)')} — ${validationErrors[0]?.message}`
                  : translate('workflows.canvas.runNow', 'Run workflow')
            }
          >
            {isRunning ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
          </button>
          {validationErrors.length > 0 && !isRunning && (
            <div className="absolute -top-1 -right-1 size-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center pointer-events-none">
              <AlertTriangle className="size-2.5" />
            </div>
          )}
        </div>
        <button
          type="button"
          className="flex items-center justify-center size-8 rounded-full border border-border bg-background text-foreground shadow-md hover:bg-accent transition-colors"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => setShowAddMenu((v) => !v)}
          title={translate('workflows.canvas.addNodeButton', 'Add node')}
        >
          <Plus className="size-4" />
        </button>
      </div>
    </div>
  )
}
