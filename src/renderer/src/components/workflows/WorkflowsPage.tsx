import { useState, useEffect, useRef } from 'react'
import WorkflowList from './WorkflowList'
import WorkflowVariablesPanel from './WorkflowVariablesPanel'
import WorkflowCanvas from './WorkflowCanvas'
import WorkflowNodeEditorPanel from './WorkflowNodeEditorPanel'
import WorkflowBottomPanel from './WorkflowBottomPanel'
import PanelDivider from './PanelDivider'
import { usePersistedSize } from '@/hooks/use-persisted-size'
import { useAppStore } from '@/store'
import type { AgentWorkflow } from '../../../../shared/workflow-types'

type LeftTab = 'workflows' | 'variables'

export default function WorkflowsPage(): React.JSX.Element {
  const [leftTab, setLeftTab] = useState<LeftTab>('workflows')
  const [canvasFocused, setCanvasFocused] = useState<boolean>(() => {
    try {
      return localStorage.getItem('wf-canvas-focused') === '1'
    } catch {
      return false
    }
  })

  function setCanvasFocusedPersisted(value: boolean): void {
    setCanvasFocused(value)
    try {
      localStorage.setItem('wf-canvas-focused', value ? '1' : '0')
    } catch {
      // ignore — storage unavailable
    }
  }
  const [selectedWorkflow, setSelectedWorkflow] = useState<AgentWorkflow | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  const storedWorkflowId = useAppStore((s) => s.selectedWorkflowId)
  const setSelectedWorkflowId = useAppStore((s) => s.setSelectedWorkflowId)
  // Capture the stored ID at mount time so the restore effect has a stable ref
  const restoreIdRef = useRef(storedWorkflowId)

  // Restore last-selected workflow on mount
  useEffect(() => {
    const id = restoreIdRef.current
    if (!id) {
      return
    }
    void window.api.workflows.list().then((wfs) => {
      const match = wfs.find((w) => w.id === id)
      if (match) {
        setSelectedWorkflow(match)
      }
    })
  }, [])

  function handleSelect(wf: AgentWorkflow | null): void {
    setSelectedWorkflow(wf)
    setSelectedWorkflowId(wf?.id ?? null)
  }

  const [leftWidth, adjustLeft] = usePersistedSize('wf-panel-left', 240, 160, 420)
  const [rightWidth, adjustRight] = usePersistedSize('wf-panel-right', 320, 200, 520)
  const [bottomHeight, adjustBottom] = usePersistedSize('wf-panel-bottom', 220, 80, 420)

  // Auto-unfocus when no workflow selected to prevent a stuck state where the
  // list panel is hidden with no way to escape. Only update React state here —
  // keeping localStorage intact so focus is restored when a workflow is reselected.
  useEffect(() => {
    if (selectedWorkflow === null && canvasFocused) {
      setCanvasFocused(false)
    }
  }, [selectedWorkflow, canvasFocused])

  const selectedWorkflowId = selectedWorkflow?.id ?? null

  // Re-apply persisted focus whenever a workflow is (re)selected, e.g. after
  // switching workspaces/views causes selectedWorkflow to temporarily reset.
  useEffect(() => {
    if (selectedWorkflowId === null) {
      return
    }
    try {
      if (localStorage.getItem('wf-canvas-focused') === '1') {
        setCanvasFocused(true)
      }
    } catch {
      // ignore — storage unavailable
    }
  }, [selectedWorkflowId])

  useEffect(() => {
    if (!selectedWorkflowId) {
      return
    }
    const unsub = window.api.workflows.onChanged(({ workflows }) => {
      const updated = workflows.find((w) => w.id === selectedWorkflowId)
      if (updated) {
        setSelectedWorkflow(updated)
      }
    })
    return unsub
  }, [selectedWorkflowId])

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-background">
      <div className="flex flex-row flex-1 min-h-0 overflow-hidden">
        {!canvasFocused && (
          <>
            <div
              className="shrink-0 border-r border-border flex flex-col min-h-0 overflow-hidden"
              style={{ width: leftWidth }}
            >
              <div className="flex border-b border-border shrink-0">
                <button
                  className={`flex-1 py-1.5 text-xs font-medium transition-colors ${leftTab === 'workflows' ? 'text-foreground border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={() => setLeftTab('workflows')}
                >
                  Workflows
                </button>
                <button
                  className={`flex-1 py-1.5 text-xs font-medium transition-colors ${leftTab === 'variables' ? 'text-foreground border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={() => setLeftTab('variables')}
                >
                  Variables
                </button>
              </div>
              {leftTab === 'workflows' ? (
                <WorkflowList
                  selectedWorkflowId={selectedWorkflow?.id ?? null}
                  onSelect={handleSelect}
                />
              ) : (
                <WorkflowVariablesPanel />
              )}
            </div>
            <PanelDivider direction="horizontal" onDelta={adjustLeft} />
          </>
        )}
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          <div className="flex flex-row flex-1 min-h-0">
            <div className="flex-1 min-w-0 min-h-0">
              <WorkflowCanvas
                workflow={selectedWorkflow}
                focused={canvasFocused}
                onFocus={() => setCanvasFocusedPersisted(true)}
                onUnfocus={() => setCanvasFocusedPersisted(false)}
                onNodeSelect={setSelectedNodeId}
                selectedNodeId={selectedNodeId}
              />
            </div>
            {selectedNodeId !== null && selectedWorkflow !== null && (
              <>
                <PanelDivider direction="horizontal" onDelta={(d) => adjustRight(-d)} />
                <div className="shrink-0 border-l border-border" style={{ width: rightWidth }}>
                  <WorkflowNodeEditorPanel
                    key={selectedNodeId}
                    workflow={selectedWorkflow}
                    nodeId={selectedNodeId}
                    onClose={() => setSelectedNodeId(null)}
                    onWorkflowChange={setSelectedWorkflow}
                  />
                </div>
              </>
            )}
          </div>
          {selectedWorkflow !== null && !canvasFocused && (
            <>
              <PanelDivider direction="vertical" onDelta={(d) => adjustBottom(-d)} />
              <div
                className="border-t border-border shrink-0 overflow-hidden"
                style={{ height: bottomHeight }}
              >
                <WorkflowBottomPanel workflowId={selectedWorkflow.id} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
