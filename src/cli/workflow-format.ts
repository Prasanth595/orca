import type { AgentWorkflow, WorkflowRun } from '../shared/workflow-types'

export type WorkflowListPayload = { workflows: AgentWorkflow[] }
export type WorkflowShowPayload = { workflow: AgentWorkflow | null }
export type WorkflowImportPayload = { workflow: AgentWorkflow }
export type WorkflowRunPayload = { run: WorkflowRun }
export type WorkflowRunsPayload = { runs: WorkflowRun[] }
export type WorkflowDeletePayload = { deleted: boolean }

export function formatWorkflowList(result: WorkflowListPayload): string {
  if (result.workflows.length === 0) {
    return 'No workflows found.'
  }
  return result.workflows
    .map((workflow) => {
      const status = workflow.enabled ? 'enabled' : 'disabled'
      const schedule = workflow.schedule ? `cron: ${workflow.schedule}` : 'manual trigger'
      const target =
        workflow.executionTargetType === 'ssh' ? `ssh: ${workflow.executionTargetId}` : 'local'
      return `${workflow.id}  ${workflow.name}  ${status}\nschedule: ${schedule}  target: ${target}  nodes: ${workflow.nodes.length}`
    })
    .join('\n\n')
}

export function formatWorkflowShow(result: WorkflowShowPayload): string {
  if (!result.workflow) {
    return 'Workflow not found.'
  }
  const workflow = result.workflow
  const schedule = workflow.schedule ? `cron: ${workflow.schedule}` : 'manual trigger'
  const target =
    workflow.executionTargetType === 'ssh' ? `ssh: ${workflow.executionTargetId}` : 'local'
  const nodeLines = workflow.nodes.map((node) => {
    const retry = 'retryCount' in node && node.retryCount ? `  retries: ${node.retryCount}` : ''
    return `  ${node.type}  ${node.id}${'label' in node && node.label ? `  label: ${node.label}` : ''}${retry}`
  })
  return [
    `id: ${workflow.id}`,
    `name: ${workflow.name}`,
    `description: ${workflow.description || '(none)'}`,
    `status: ${workflow.enabled ? 'enabled' : 'disabled'}`,
    `schedule: ${schedule}`,
    `target: ${target}`,
    `nodes (${workflow.nodes.length}):`,
    ...nodeLines,
    `edges (${workflow.edges.length}): ${workflow.edges
      .map((edge) => `${edge.sourceNodeId}→${edge.targetNodeId}`)
      .join(', ')}`
  ].join('\n')
}

export function formatWorkflowImport(result: WorkflowImportPayload): string {
  const workflow = result.workflow
  return `Imported "${workflow.name}" (${workflow.id}) with ${workflow.nodes.length} nodes. Open it from the Workflows page in Orca.`
}

export function formatWorkflowRun(result: WorkflowRunPayload): string {
  const run = result.run
  const completed = run.completedAt ? `completed: ${new Date(run.completedAt).toISOString()}` : ''
  const error = run.error ? `\nerror: ${run.error}` : ''
  return `run: ${run.id}\nstatus: ${run.status}\nstarted: ${new Date(run.startedAt).toISOString()}${completed}${error}`
}

export function formatWorkflowRuns(result: WorkflowRunsPayload): string {
  if (result.runs.length === 0) {
    return 'No workflow runs found.'
  }
  return result.runs
    .map((run) => {
      const error = run.error ? `  error: ${run.error}` : ''
      return `${run.id}  ${run.status}  ${run.trigger}  ${new Date(run.startedAt).toISOString()}${error}`
    })
    .join('\n')
}

export function formatWorkflowDelete(result: WorkflowDeletePayload): string {
  return result.deleted ? 'Workflow deleted.' : 'Workflow not found.'
}
