import type { AgentWorkflow, WorkflowEdge, WorkflowNode } from '../../../shared/workflow-types'
import { exportWorkflowJson } from '../../../shared/workflow-export'

export type { WorkflowExportFile } from '../../../shared/workflow-export'
import { assignImportedWorkflowIds, parseWorkflowExport } from '../../../shared/workflow-export'
import { createBrowserUuid } from '@/lib/browser-uuid'

export function exportWorkflow(workflow: AgentWorkflow): string {
  return exportWorkflowJson(workflow)
}

export function downloadWorkflowJson(workflow: AgentWorkflow): void {
  const data = exportWorkflow(workflow)
  const blob = new Blob([data], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${workflow.name.replace(/[^a-z0-9_-]/gi, '_')}.workflow.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function importWorkflowJson(raw: string): {
  name: string
  executionTargetType: 'local' | 'ssh'
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
} {
  return assignImportedWorkflowIds(parseWorkflowExport(raw), createBrowserUuid)
}
