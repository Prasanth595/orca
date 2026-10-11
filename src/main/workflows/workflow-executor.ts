import type { AgentWorkflow, WorkflowNode, WorkflowNodeRun } from '../../shared/workflow-types'
import { topologicalSort } from '../../shared/workflow-graph-topology'
import { resolveTemplateExpr } from '../../shared/workflow-template-path'
import { runShellCommandNode } from './workflow-node-runner-shell'
import { runPythonScriptNode } from './workflow-node-runner-python'
import { runAgentCallNode } from './workflow-node-runner-agent'
import { runFileReadNode, runFileWriteNode } from './workflow-node-runner-file'
import { runEmailSendNode } from './workflow-node-runner-email'
import { runJsonTransformNode } from './workflow-node-runner-json'
import type { WorkflowStoreOperations } from './workflow-run-store'
import { patchNodeRun, finalizeWorkflowRun } from './workflow-run-store'
import type { RemoteExecFn } from './workflow-remote-exec'

export type WorkflowExecutorCallbacks = {
  onNodeStart?: (runId: string, nodeId: string) => void
  onNodeComplete?: (runId: string, nodeId: string, nodeRun: WorkflowNodeRun) => void
  onRunComplete?: (runId: string) => void
}

type StepOutputs = Record<string, { output: string; json: unknown }>

function resolveField(value: string, steps: StepOutputs): string {
  return resolveTemplateExpr(value, steps)
}

async function executeNode(
  node: WorkflowNode,
  steps: StepOutputs,
  signal: AbortSignal,
  remoteExec?: RemoteExecFn
): Promise<{ stdout: string; stderr: string; outputValue: unknown; exitCode: number | null }> {
  // Use the last non-trigger step's output as stdin where applicable
  const prevIds = Object.keys(steps)
  const prevOutput = prevIds.length > 0 ? (steps[prevIds.at(-1)!]?.output ?? '') : ''

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
        prevOutput,
        remoteExec,
        signal
      )
      return { ...r, outputValue: { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode } }
    }
    case 'python_script': {
      if (signal.aborted) {
        throw new Error('Cancelled')
      }
      const r = await runPythonScriptNode(node.data, prevOutput, remoteExec, signal)
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
      const inputJson = prevIds.length > 0 ? steps[prevIds.at(-1)!]?.json : undefined
      const r = runJsonTransformNode(
        { expression: resolveField(node.data.expression, steps) },
        inputJson
      )
      return {
        stdout: JSON.stringify(r.value),
        stderr: '',
        outputValue: r.value,
        exitCode: 0
      }
    }
  }
}

export async function executeWorkflow(
  workflow: AgentWorkflow,
  runId: string,
  ops: WorkflowStoreOperations,
  callbacks: WorkflowExecutorCallbacks = {},
  signal: AbortSignal = new AbortController().signal,
  remoteExec?: RemoteExecFn
): Promise<void> {
  const sorted = topologicalSort(workflow)
  if (!sorted) {
    finalizeWorkflowRun(ops, runId, 'failed', 'Workflow graph has a cycle or invalid edges.')
    callbacks.onRunComplete?.(runId)
    return
  }

  const steps: StepOutputs = {}

  for (const node of sorted) {
    if (signal.aborted) {
      finalizeWorkflowRun(ops, runId, 'cancelled', 'Workflow was cancelled.')
      callbacks.onRunComplete?.(runId)
      return
    }

    patchNodeRun(ops, runId, node.id, { status: 'running', startedAt: Date.now() })
    callbacks.onNodeStart?.(runId, node.id)

    const startMs = Date.now()
    try {
      const result = await executeNode(node, steps, signal, remoteExec)
      const durationMs = Date.now() - startMs
      let json: unknown = null
      try {
        json = JSON.parse(result.stdout)
      } catch {
        json = null
      }

      steps[node.id] = { output: result.stdout, json: json ?? result.outputValue }

      const nodeRun = patchNodeRun(ops, runId, node.id, {
        status: 'completed',
        completedAt: Date.now(),
        stdout: result.stdout,
        stderr: result.stderr,
        outputValue: result.outputValue,
        durationMs,
        error: null
      })
      if (nodeRun) {
        const nr = nodeRun.nodeRuns.find((nr) => nr.nodeId === node.id)
        if (nr) {
          callbacks.onNodeComplete?.(runId, node.id, nr)
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      const durationMs = Date.now() - startMs
      patchNodeRun(ops, runId, node.id, {
        status: 'failed',
        completedAt: Date.now(),
        error,
        durationMs
      })
      finalizeWorkflowRun(
        ops,
        runId,
        'failed',
        `Node ${node.type} ${node.id.slice(0, 8)} failed: ${error}`
      )
      callbacks.onRunComplete?.(runId)
      return
    }
  }

  finalizeWorkflowRun(ops, runId, 'completed')
  callbacks.onRunComplete?.(runId)
}
