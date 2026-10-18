import type { WorkflowEdge, WorkflowNode } from './workflow-types'

/** Version-1 export shape shared by the renderer download and the CLI import surface. */
export type WorkflowExportFile = {
  version: 1
  name: string
  executionTargetType: 'local' | 'ssh'
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

export type ParsedWorkflowExport = {
  name: string
  executionTargetType: 'local' | 'ssh'
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

export function exportWorkflowJson(workflow: {
  name: string
  executionTargetType: 'local' | 'ssh'
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}): string {
  const data: WorkflowExportFile = {
    version: 1,
    name: workflow.name,
    executionTargetType: workflow.executionTargetType,
    nodes: workflow.nodes,
    edges: workflow.edges
  }
  return JSON.stringify(data, null, 2)
}

export function parseWorkflowExport(raw: string): WorkflowExportFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Invalid workflow export file (not JSON)')
  }
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
  return file
}

/** Re-ids an imported export: fresh node/edge ids, template references rewritten, pos nudged. */
export function assignImportedWorkflowIds(
  parsed: Pick<WorkflowExportFile, 'name' | 'executionTargetType' | 'nodes' | 'edges'>,
  createId: () => string
): ParsedWorkflowExport {
  const idMap = new Map<string, string>()
  for (const node of parsed.nodes) {
    idMap.set(node.id, createId())
  }

  // Rewrite {{steps.OLD_ID.x}} → {{steps.NEW_ID.x}} across all node data via JSON round-trip
  const remapTemplates = (text: string): string => {
    let result = text
    for (const [oldId, newId] of idMap) {
      result = result.replaceAll(`{{steps.${oldId}.`, `{{steps.${newId}.`)
    }
    return result
  }

  const remappedNodes: WorkflowNode[] = parsed.nodes.map((node) => {
    const newId = idMap.get(node.id) ?? createId()
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

  const remappedEdges: WorkflowEdge[] = parsed.edges.map((edge) => ({
    ...edge,
    id: createId(),
    sourceNodeId: idMap.get(edge.sourceNodeId) ?? edge.sourceNodeId,
    targetNodeId: idMap.get(edge.targetNodeId) ?? edge.targetNodeId
  }))

  return {
    name: typeof parsed.name === 'string' ? parsed.name : 'Imported Workflow',
    executionTargetType: parsed.executionTargetType === 'ssh' ? 'ssh' : 'local',
    nodes: remappedNodes,
    edges: remappedEdges
  }
}
