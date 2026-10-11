import type { AgentWorkflow, WorkflowEdge, WorkflowNode } from '../../shared/workflow-types'
import { resolveTemplateExpr } from '../../shared/workflow-template-path'
import { runShellCommandNode } from './workflow-node-runner-shell'
import { runPythonScriptNode } from './workflow-node-runner-python'
import { runAgentCallNode } from './workflow-node-runner-agent'
import { runFileReadNode, runFileWriteNode } from './workflow-node-runner-file'
import { runEmailSendNode } from './workflow-node-runner-email'
import { runJsonTransformNode } from './workflow-node-runner-json'
import { evaluateBranchConditions } from './workflow-node-runner-branch'
import { patchNodeRun } from './workflow-run-store'
import type { WorkflowStoreOperations } from './workflow-run-store'
import type { RemoteExecFn } from './workflow-remote-exec'

export type StepOutputs = Record<string, { output: string; json: unknown }>

export type ExecuteNodeResult = {
  stdout: string
  stderr: string
  outputValue: unknown
  exitCode: number | null
  /** Branch: the output label that was selected */
  activeLabel?: string
  /** ForEach: body node IDs handled internally (caller must mark them completed) */
  handledNodeIds?: string[]
}

function resolveField(value: string, steps: StepOutputs): string {
  return resolveTemplateExpr(value, steps)
}

/** Returns { output, json } from the first direct parent in the workflow graph. */
export function resolveNodeInputs(
  nodeId: string,
  edges: WorkflowEdge[],
  steps: StepOutputs
): { primaryOutput: string; primaryJson: unknown } {
  const parentEdge = edges.find((e) => e.targetNodeId === nodeId)
  if (!parentEdge) {
    return { primaryOutput: '', primaryJson: null }
  }
  const parent = steps[parentEdge.sourceNodeId]
  return { primaryOutput: parent?.output ?? '', primaryJson: parent?.json ?? null }
}

/**
 * BFS from startNodeId through the graph, stopping when we reach stopNodeId (inclusive)
 * or hit a collect node.
 */
export function getBodyNodes(
  startNodeId: string,
  stopNodeId: string | null,
  workflow: AgentWorkflow
): WorkflowNode[] {
  const nodeById = new Map(workflow.nodes.map((n) => [n.id, n]))
  const result: WorkflowNode[] = []
  const visited = new Set<string>()
  const queue = [startNodeId]
  while (queue.length > 0) {
    const id = queue.shift()!
    if (visited.has(id)) {
      continue
    }
    visited.add(id)
    const node = nodeById.get(id)
    if (!node) {
      continue
    }
    result.push(node)
    if (id === stopNodeId) {
      break
    }
    if (node.type === 'collect') {
      break
    }
    for (const edge of workflow.edges.filter((e) => e.sourceNodeId === id)) {
      if (!visited.has(edge.targetNodeId)) {
        queue.push(edge.targetNodeId)
      }
    }
  }
  return result
}

export async function executeNode(
  node: WorkflowNode,
  workflow: AgentWorkflow,
  steps: StepOutputs,
  runId: string,
  ops: WorkflowStoreOperations,
  signal: AbortSignal,
  remoteExec?: RemoteExecFn
): Promise<ExecuteNodeResult> {
  const { primaryOutput, primaryJson } = resolveNodeInputs(node.id, workflow.edges, steps)

  switch (node.type) {
    case 'trigger_cron':
    case 'trigger_manual': {
      const ts = new Date().toISOString()
      return { stdout: ts, stderr: '', outputValue: { timestamp: ts }, exitCode: 0 }
    }
    case 'shell_command': {
      if (signal.aborted) {
        throw new Error('Cancelled')
      }
      const r = await runShellCommandNode(
        { ...node.data, command: resolveField(node.data.command, steps) },
        primaryOutput,
        remoteExec,
        signal
      )
      return { ...r, outputValue: { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode } }
    }
    case 'python_script': {
      if (signal.aborted) {
        throw new Error('Cancelled')
      }
      const r = await runPythonScriptNode(node.data, primaryOutput, remoteExec, signal)
      return { ...r, outputValue: { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode } }
    }
    case 'agent_call': {
      if (signal.aborted) {
        throw new Error('Cancelled')
      }
      const prompt = resolveField(node.data.prompt, steps)
      const r = await runAgentCallNode(node.data, prompt, remoteExec, signal)
      let parsed: unknown = null
      if (node.data.structuredOutputSchema) {
        try {
          parsed = JSON.parse(r.stdout)
        } catch {
          parsed = null
        }
      }
      return { ...r, outputValue: parsed ?? { stdout: r.stdout, stderr: r.stderr } }
    }
    case 'file_read': {
      const r = await runFileReadNode(
        { filePath: resolveField(node.data.filePath, steps) },
        remoteExec
      )
      return { stdout: r.content, stderr: '', outputValue: { content: r.content }, exitCode: 0 }
    }
    case 'file_write': {
      const r = await runFileWriteNode(
        { ...node.data, filePath: resolveField(node.data.filePath, steps) },
        resolveField(node.data.content, steps),
        remoteExec
      )
      return { stdout: '', stderr: '', outputValue: r, exitCode: 0 }
    }
    case 'email_send': {
      const r = await runEmailSendNode(
        node.data,
        resolveField(node.data.to, steps),
        resolveField(node.data.subject, steps),
        resolveField(node.data.body, steps)
      )
      return { stdout: r.message, stderr: '', outputValue: r, exitCode: 0 }
    }
    case 'json_transform': {
      const r = runJsonTransformNode(
        { expression: resolveField(node.data.expression, steps) },
        primaryJson
      )
      return { stdout: JSON.stringify(r.value), stderr: '', outputValue: r.value, exitCode: 0 }
    }
    case 'branch': {
      const { exitCode } = primaryOutput
        ? (() => {
            let ec: number | null = null
            try {
              // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: parsing runtime JSON; exitCode may or may not be present
              ec = (JSON.parse(primaryOutput) as { exitCode?: number } | null)?.exitCode ?? null
            } catch {
              /* ignore */
            }
            return { exitCode: ec }
          })()
        : { exitCode: null }
      const activeLabel = evaluateBranchConditions(node.data, {
        output: primaryOutput,
        json: primaryJson,
        exitCode
      })
      return {
        stdout: activeLabel,
        stderr: '',
        outputValue: { label: activeLabel },
        exitCode: 0,
        activeLabel
      }
    }
    case 'for_each': {
      const rawItems = resolveField(node.data.itemsExpression, steps)
      let items: unknown[] = []
      try {
        const parsed: unknown = JSON.parse(rawItems)
        items = Array.isArray(parsed) ? parsed : [parsed]
      } catch {
        if (Array.isArray(primaryJson)) {
          items = primaryJson
        } else if (primaryJson) {
          items = [primaryJson]
        }
      }
      items = items.slice(0, node.data.maxIterations)

      const bodyEdge = workflow.edges.find(
        (e) => e.sourceNodeId === node.id && e.outputSelector === 'body'
      )
      const bodyNodes = bodyEdge ? getBodyNodes(bodyEdge.targetNodeId, null, workflow) : []
      const bodyNodeIds = bodyNodes.map((n) => n.id)
      const iterResults: unknown[] = []

      for (let i = 0; i < items.length; i++) {
        if (signal.aborted) {
          break
        }
        const loopSteps: StepOutputs = {
          ...steps,
          __loop__: {
            output: JSON.stringify(items[i]),
            json: { item: items[i], index: i }
          }
        }
        let lastOutput: unknown = null
        for (const bodyNode of bodyNodes) {
          if (signal.aborted) {
            break
          }
          const r = await executeNode(bodyNode, workflow, loopSteps, runId, ops, signal, remoteExec)
          let json: unknown = null
          try {
            json = JSON.parse(r.stdout)
          } catch {}
          loopSteps[bodyNode.id] = { output: r.stdout, json: json ?? r.outputValue }
          lastOutput = r.outputValue
        }
        iterResults.push(lastOutput)
      }

      const aggregated = JSON.stringify(iterResults)
      for (const bodyNode of bodyNodes) {
        patchNodeRun(ops, runId, bodyNode.id, {
          status: 'completed',
          completedAt: Date.now(),
          stdout: aggregated,
          outputValue: iterResults,
          error: null
        })
      }

      return {
        stdout: aggregated,
        stderr: '',
        outputValue: { items: iterResults, count: iterResults.length },
        exitCode: 0,
        handledNodeIds: bodyNodeIds
      }
    }
    case 'collect': {
      return {
        stdout: primaryOutput,
        stderr: '',
        outputValue: primaryJson,
        exitCode: 0
      }
    }
  }
}
