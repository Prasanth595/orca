import { useState, useEffect } from 'react'
import type { WorkflowRun, WorkflowNodeType } from '../../../shared/workflow-types'

export type StepOutput = { output: string; json: unknown; nodeType?: WorkflowNodeType }
export type LastOutputsResult = {
  outputs: Record<string, StepOutput>
  // Node IDs in execution order (sorted by startedAt, nulls last)
  orderedNodeIds: string[]
}

function extractLastOutputs(run: WorkflowRun): LastOutputsResult {
  const outputs: Record<string, StepOutput> = {}
  for (const nr of run.nodeRuns) {
    if (nr.stdout !== null || nr.outputValue !== null) {
      let json: unknown = null
      if (nr.stdout) {
        try {
          json = JSON.parse(nr.stdout)
        } catch {
          json = nr.outputValue
        }
      } else {
        json = nr.outputValue
      }
      outputs[nr.nodeId] = {
        output: nr.stdout ?? '',
        json: json ?? nr.outputValue,
        nodeType: nr.nodeType
      }
    }
  }
  const orderedNodeIds = [...run.nodeRuns]
    .sort((a, b) => (a.startedAt ?? Infinity) - (b.startedAt ?? Infinity))
    .map((nr) => nr.nodeId)
    .filter((id) => outputs[id] !== undefined)
  return { outputs, orderedNodeIds }
}

export function useWorkflowLastOutputs(workflowId: string | null): LastOutputsResult | null {
  const [result, setResult] = useState<LastOutputsResult | null>(null)

  useEffect(() => {
    if (!workflowId) {
      setResult(null)
      return
    }

    void window.api.workflows.getRuns(workflowId).then((runs) => {
      const sorted = [...runs].sort((a, b) => b.startedAt - a.startedAt)
      const last = sorted.find((r) => r.status === 'completed')
      setResult(last ? extractLastOutputs(last) : null)
    })

    const unsub = window.api.workflows.onRunUpdated(({ workflowId: wid, run }) => {
      if (wid !== workflowId || run.status !== 'completed') {
        return
      }
      setResult(extractLastOutputs(run))
    })
    return unsub
  }, [workflowId])

  return result
}
