import { useState, useEffect, useMemo } from 'react'
import type {
  WorkflowRun,
  WorkflowNodeRunStatus,
  AgentWorkflow
} from '../../../../shared/workflow-types'

type WorkflowRunStatus = {
  activeRun: WorkflowRun | null
  setActiveRun: (run: WorkflowRun | null) => void
  isRunning: boolean
  nodeRunStatuses: Record<string, WorkflowNodeRunStatus>
}

export function useWorkflowRunStatus(workflow: AgentWorkflow | null): WorkflowRunStatus {
  const [activeRun, setActiveRun] = useState<WorkflowRun | null>(null)

  useEffect(() => {
    if (!workflow) {
      setActiveRun(null)
      return
    }
    let dismissTimer: ReturnType<typeof setTimeout> | null = null
    const unsub = window.api.workflows.onRunUpdated(({ workflowId: wid, run }) => {
      if (wid !== workflow.id) {
        return
      }
      setActiveRun(run)
      if (run.status !== 'running' && run.status !== 'pending') {
        if (dismissTimer) {
          clearTimeout(dismissTimer)
        }
        dismissTimer = setTimeout(() => setActiveRun(null), 6000)
      }
    })
    return () => {
      unsub()
      if (dismissTimer) {
        clearTimeout(dismissTimer)
      }
    }
  }, [workflow])

  const nodeRunStatuses = useMemo((): Record<string, WorkflowNodeRunStatus> => {
    if (!activeRun) {
      return {}
    }
    return Object.fromEntries(activeRun.nodeRuns.map((nr) => [nr.nodeId, nr.status]))
  }, [activeRun])

  return { activeRun, setActiveRun, isRunning: activeRun?.status === 'running', nodeRunStatuses }
}
