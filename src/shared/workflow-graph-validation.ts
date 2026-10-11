import type { AgentWorkflow } from './workflow-types'
import { topologicalSort } from './workflow-graph-topology'

export type WorkflowValidationError =
  | { kind: 'no_trigger'; message: string }
  | { kind: 'multiple_triggers'; message: string }
  | { kind: 'cycle'; message: string }
  | { kind: 'missing_node'; message: string; nodeId: string }
  | { kind: 'empty_workflow'; message: string }
  | { kind: 'branch_no_outputs'; message: string; nodeId: string }
  | { kind: 'branch_unlabeled_edge'; message: string; nodeId: string }
  | { kind: 'foreach_missing_edge'; message: string; nodeId: string }

export function validateWorkflow(workflow: AgentWorkflow): WorkflowValidationError[] {
  const errors: WorkflowValidationError[] = []
  if (workflow.nodes.length === 0) {
    errors.push({ kind: 'empty_workflow', message: 'Workflow has no nodes.' })
    return errors
  }
  const nodeIds = new Set(workflow.nodes.map((n) => n.id))
  for (const edge of workflow.edges) {
    if (!nodeIds.has(edge.sourceNodeId)) {
      errors.push({
        kind: 'missing_node',
        message: `Edge references missing node: ${edge.sourceNodeId}`,
        nodeId: edge.sourceNodeId
      })
    }
    if (!nodeIds.has(edge.targetNodeId)) {
      errors.push({
        kind: 'missing_node',
        message: `Edge references missing node: ${edge.targetNodeId}`,
        nodeId: edge.targetNodeId
      })
    }
  }
  const triggers = workflow.nodes.filter(
    (n) => n.type === 'trigger_cron' || n.type === 'trigger_manual'
  )
  if (triggers.length === 0) {
    errors.push({ kind: 'no_trigger', message: 'Workflow must have at least one trigger node.' })
  }
  if (triggers.length > 1) {
    errors.push({
      kind: 'multiple_triggers',
      message: 'Workflow has more than one trigger node; only one trigger is supported.'
    })
  }
  for (const node of workflow.nodes.filter((n) => n.type === 'branch')) {
    const outEdges = workflow.edges.filter((e) => e.sourceNodeId === node.id)
    if (outEdges.length < 2) {
      errors.push({
        kind: 'branch_no_outputs',
        message: 'Branch node must have at least two outgoing edges.',
        nodeId: node.id
      })
    }
    if (outEdges.some((e) => !e.outputSelector)) {
      errors.push({
        kind: 'branch_unlabeled_edge',
        message: 'All edges from a Branch node must have a label.',
        nodeId: node.id
      })
    }
  }
  for (const node of workflow.nodes.filter((n) => n.type === 'for_each')) {
    const outEdges = workflow.edges.filter((e) => e.sourceNodeId === node.id)
    const hasBody = outEdges.some((e) => e.outputSelector === 'body')
    const hasDone = outEdges.some((e) => e.outputSelector === 'done')
    if (!hasBody || !hasDone) {
      errors.push({
        kind: 'foreach_missing_edge',
        message: "ForEach node requires both a 'body' edge and a 'done' edge.",
        nodeId: node.id
      })
    }
  }
  if (topologicalSort(workflow) === null) {
    errors.push({ kind: 'cycle', message: 'Workflow graph contains a cycle.' })
  }
  return errors
}
