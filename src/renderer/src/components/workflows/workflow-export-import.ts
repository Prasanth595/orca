import { createBrowserUuid } from '@/lib/browser-uuid'
import type { AgentWorkflow, WorkflowEdge, WorkflowNode } from '../../../../shared/workflow-types'

export type WorkflowExportFile = {
  version: 1
  name: string
  executionTargetType: 'local' | 'ssh'
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

export function exportWorkflow(workflow: AgentWorkflow): WorkflowExportFile {
  return {
    version: 1,
    name: workflow.name,
    executionTargetType: workflow.executionTargetType,
    nodes: workflow.nodes,
    edges: workflow.edges
  }
}

export function downloadWorkflowJson(workflow: AgentWorkflow): void {
  const data = exportWorkflow(workflow)
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
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
  const parsed: unknown = JSON.parse(raw)
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: guarded by typeof+null checks above; only reading version to validate.
    (parsed as WorkflowExportFile).version !== 1
  ) {
    throw new Error('Invalid workflow export file (expected version 1)')
  }

  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: version===1 check above plus array guards below confirm the shape before any field access.
  const file = parsed as WorkflowExportFile
  if (!Array.isArray(file.nodes) || !Array.isArray(file.edges)) {
    throw new Error('Invalid workflow export file (missing nodes or edges)')
  }

  // Build old-ID → new-ID map for all nodes
  const idMap = new Map<string, string>()
  for (const node of file.nodes) {
    idMap.set(node.id, createBrowserUuid())
  }

  // Rewrite {{steps.OLD_ID.x}} → {{steps.NEW_ID.x}} across all node data via JSON round-trip
  const remapTemplates = (text: string): string => {
    let result = text
    for (const [oldId, newId] of idMap) {
      result = result.replaceAll(`{{steps.${oldId}.`, `{{steps.${newId}.`)
    }
    return result
  }

  const remappedNodes: WorkflowNode[] = file.nodes.map((node) => {
    const newId = idMap.get(node.id) ?? createBrowserUuid()
    const remappedDataJson = remapTemplates(JSON.stringify(node.data))
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: remappedDataJson is the serialized node.data with only string values rewritten; shape and type are preserved.
    const remappedData = JSON.parse(remappedDataJson) as WorkflowNode['data']
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: spread preserves the node's `type` discriminant; remappedData is the same shape with template strings rewritten.
    return {
      ...node,
      id: newId,
      pos: { x: node.pos.x + 40, y: node.pos.y + 40 },
      data: remappedData
    } as WorkflowNode
  })

  const remappedEdges: WorkflowEdge[] = file.edges.map((edge) => ({
    ...edge,
    id: createBrowserUuid(),
    sourceNodeId: idMap.get(edge.sourceNodeId) ?? edge.sourceNodeId,
    targetNodeId: idMap.get(edge.targetNodeId) ?? edge.targetNodeId
  }))

  return {
    name: typeof file.name === 'string' ? file.name : 'Imported Workflow',
    executionTargetType: file.executionTargetType === 'ssh' ? 'ssh' : 'local',
    nodes: remappedNodes,
    edges: remappedEdges
  }
}
