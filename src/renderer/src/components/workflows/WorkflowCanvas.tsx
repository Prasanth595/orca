import { useState, useRef, useEffect, useMemo } from 'react'
import { Maximize2, Minimize2, Plus, Workflow, Play, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { buildDefaultNode, getOutputPorts } from './workflow-canvas-node-config'
import { usePersistedCanvasPan } from '@/hooks/use-persisted-canvas-pan'
import { useWorkflowRunStatus } from './use-workflow-run-status'
import WorkflowCanvasEdgesLayer from './WorkflowCanvasEdgesLayer'
import WorkflowAddNodeMenu from './WorkflowAddNodeMenu'
import WorkflowCanvasNode from './WorkflowCanvasNode'
import WorkflowRunBanner from './WorkflowRunBanner'
import WorkflowExecutionTargetBadge from './WorkflowExecutionTargetBadge'
import WorkflowValidationButton from './WorkflowValidationButton'
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
  type ConnectState = { nodeId: string; outputSelector?: string }
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [connectingFrom, setConnectingFrom] = useState<ConnectState | null>(null)
  const [draggingPos, setDraggingPos] = useState<{ nodeId: string; x: number; y: number } | null>(
    null
  )
  const [isPanning, setIsPanning] = useState(false)
  const { activeRun, setActiveRun, isRunning, nodeRunStatuses } = useWorkflowRunStatus(workflow)

  type DragState = { nodeId: string; startX: number; startY: number; origX: number; origY: number }
  const dragRef = useRef<DragState | null>(null)
  const didDragNodeRef = useRef(false)
  type PanState = { startX: number; startY: number; origX: number; origY: number }
  const panDragRef = useRef<PanState | null>(null)
  const didPanRef = useRef(false)
  const viewportRef = useRef<HTMLDivElement>(null)

  const [pan, setPan, persistPan] = usePersistedCanvasPan(workflow?.id ?? '')

  const validationErrors = useMemo(() => (workflow ? validateWorkflow(workflow) : []), [workflow])
  const hasErrors = validationErrors.length > 0

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

  if (workflow === null) {
    return (
      <div className="relative flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
        {focused && (
          <Button
            size="icon"
            variant="outline"
            className="absolute top-2 right-2 z-10 size-7"
            onClick={onUnfocus}
            title={translate('workflows.canvas.unfocus', 'Exit focus mode')}
          >
            <Minimize2 className="size-3.5" />
          </Button>
        )}
        <Workflow className="size-8 opacity-30" strokeWidth={1.25} />
        <span className="text-[13px]">
          {translate('workflows.canvas.empty', 'Select or create a workflow to start editing.')}
        </span>
      </div>
    )
  }

  async function connectNodes(
    sourceId: string,
    targetId: string,
    outputSelector?: string
  ): Promise<void> {
    if (!workflow || sourceId === targetId) {
      return
    }
    if (
      workflow.edges.some(
        (e) =>
          e.sourceNodeId === sourceId &&
          e.targetNodeId === targetId &&
          e.outputSelector === outputSelector
      )
    ) {
      return
    }
    const edge = {
      id: createBrowserUuid(),
      sourceNodeId: sourceId,
      targetNodeId: targetId,
      ...(outputSelector !== undefined ? { outputSelector } : {})
    }
    await window.api.workflows.update(workflow.id, { edges: [...workflow.edges, edge] })
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
    if (!workflow || isRunning || hasErrors) {
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

  return (
    <div
      ref={viewportRef}
      className={cn(
        'relative h-full w-full overflow-hidden bg-muted/10 select-none',
        connectingFrom ? 'cursor-crosshair' : isPanning ? 'cursor-grabbing' : 'cursor-grab'
      )}
      onMouseDown={handleViewportMouseDown}
    >
      <div className="absolute top-2 left-2 z-10" onMouseDown={(e) => e.stopPropagation()}>
        <WorkflowExecutionTargetBadge workflow={workflow} />
      </div>

      <Button
        size="icon"
        variant="outline"
        className="absolute top-2 right-2 z-10 size-7"
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

      {connectingFrom && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 bg-primary text-primary-foreground text-[11px] px-2 py-1 rounded shadow pointer-events-none">
          {translate(
            'workflows.canvas.connectHint',
            'Click a target node to connect — Esc to cancel'
          )}
        </div>
      )}

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
          nodes={workflow.nodes}
          edges={workflow.edges}
          draggingPos={draggingPos}
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
            isConnectingFrom={connectingFrom?.nodeId === node.id}
            runStatus={nodeRunStatuses[node.id]}
            onMouseDown={handleNodeMouseDown}
            onNodeClick={(nodeId) => {
              if (didDragNodeRef.current) {
                didDragNodeRef.current = false
                return
              }
              if (connectingFrom) {
                void connectNodes(connectingFrom.nodeId, nodeId, connectingFrom.outputSelector)
                setConnectingFrom(null)
              } else {
                onNodeSelect(nodeId)
              }
            }}
            onContextMenu={(nodeId) => {
              const n = workflow.nodes.find((nd) => nd.id === nodeId)
              if (!n || getOutputPorts(n).length > 1) {
                return
              }
              setConnectingFrom({ nodeId })
              setShowAddMenu(false)
            }}
            onConnectStart={(nodeId, outputSelector) => {
              setConnectingFrom({ nodeId, outputSelector })
              setShowAddMenu(false)
            }}
            onDelete={deleteNode}
          />
        ))}
      </div>

      {workflow.nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-[13px] text-muted-foreground/50 pointer-events-none">
          {translate('workflows.canvas.addNode', 'Click + to add nodes')}
        </div>
      )}
      {showAddMenu && <WorkflowAddNodeMenu onAdd={(type) => void addNode(type)} />}

      {activeRun && (
        <WorkflowRunBanner activeRun={activeRun} onDismiss={() => setActiveRun(null)} />
      )}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2">
        <WorkflowValidationButton errors={validationErrors} />
        <button
          type="button"
          className={cn(
            'flex items-center justify-center size-8 rounded-full border border-border bg-background text-foreground shadow-md transition-colors',
            isRunning || hasErrors ? 'opacity-60 cursor-not-allowed' : 'hover:bg-accent'
          )}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => void handleRun()}
          disabled={isRunning || hasErrors}
          title={translate('workflows.canvas.runNow', 'Run workflow')}
        >
          {isRunning ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
        </button>
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
