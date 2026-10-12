import { useState, useEffect } from 'react'
import { resolveTemplateExpr } from '../../../../shared/workflow-template-path'
import { isFinalWorkflowRunStatus } from '../../../../shared/workflow-types'

export type LastRunSteps = Record<string, { output: string; json: unknown }>

export function useLastRunSteps(workflowId: string): {
  steps: LastRunSteps
  resolveExpr: (expr: string) => string
} {
  const [steps, setSteps] = useState<LastRunSteps>({})

  useEffect(() => {
    void window.api.workflows.getRuns().then((allRuns) => {
      const lastRun = allRuns
        .filter((r) => r.workflowId === workflowId && isFinalWorkflowRunStatus(r.status))
        .sort((a, b) => (b.completedAt ?? b.startedAt) - (a.completedAt ?? a.startedAt))[0]
      if (!lastRun) {
        return
      }
      const built: LastRunSteps = {}
      for (const nr of lastRun.nodeRuns) {
        if (nr.status !== 'completed') {
          continue
        }
        const stdout = nr.stdout ?? ''
        let json: unknown = null
        try {
          json = JSON.parse(stdout)
        } catch {
          json = nr.outputValue
        }
        built[nr.nodeId] = { output: stdout, json }
      }
      setSteps(built)
    })
  }, [workflowId])

  return {
    steps,
    resolveExpr: (expr: string) => resolveTemplateExpr(expr, steps)
  }
}
