import type { AgentWorkflow, WorkflowNode, StepOutputs } from '../../shared/workflow-types'
import { resolveTemplateExpr } from '../../shared/workflow-template-path'
import { resolveNodeInputs } from './workflow-node-body-resolver'
export { resolveNodeInputs, getBodyNodes } from './workflow-node-body-resolver'
import { executeHttpRequestNode } from './workflow-node-runner-http'
import { runShellCommandNode } from './workflow-node-runner-shell'
import { runPythonScriptNode } from './workflow-node-runner-python'
import { runAgentCallNode } from './workflow-node-runner-agent'
import { runFileReadNode, runFileWriteNode } from './workflow-node-runner-file'
import { runEmailSendNode } from './workflow-node-runner-email'
import { runJsonTransformNode } from './workflow-node-runner-json'
import { evaluateBranchConditions } from './workflow-node-runner-branch'
import { runFormInputNode } from './workflow-node-runner-form'
import { runForEachNode, registerExecuteNode } from './workflow-node-runner-for-each'
import type { WorkflowStoreOperations } from './workflow-run-store'
import type { RemoteExecFn } from './workflow-remote-exec'
import { runWorkflowCallNode } from './workflow-node-runner-workflow-call'

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
        {
          ...node.data,
          command: resolveField(node.data.command, steps),
          workingDirectory: resolveField(node.data.workingDirectory, steps)
        },
        primaryOutput,
        remoteExec,
        signal
      )
      if (node.data.failOnNonZeroExit && r.exitCode !== 0) {
        throw new Error(`Shell command exited with code ${r.exitCode}`)
      }
      return { ...r, outputValue: { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode } }
    }
    case 'python_script': {
      if (signal.aborted) {
        throw new Error('Cancelled')
      }
      const r = await runPythonScriptNode(
        {
          ...node.data,
          script: resolveField(node.data.script, steps),
          workingDirectory: resolveField(node.data.workingDirectory, steps)
        },
        primaryOutput,
        remoteExec,
        signal
      )
      if (node.data.failOnNonZeroExit && r.exitCode !== 0) {
        throw new Error(`Python script exited with code ${r.exitCode}`)
      }
      return { ...r, outputValue: { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode } }
    }
    case 'agent_call': {
      if (signal.aborted) {
        throw new Error('Cancelled')
      }
      const prompt = resolveField(node.data.prompt, steps)
      const r = await runAgentCallNode(
        { ...node.data, workingDirectory: resolveField(node.data.workingDirectory, steps) },
        prompt,
        remoteExec,
        signal
      )
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
    case 'http_request': {
      const r = await executeHttpRequestNode(node.data, steps, remoteExec, signal)
      return { ...r, stderr: '', exitCode: 0 }
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
      const activeLabel = evaluateBranchConditions(
        node.data,
        { output: primaryOutput, json: primaryJson, exitCode },
        steps
      )
      return {
        stdout: activeLabel,
        stderr: '',
        outputValue: { label: activeLabel },
        exitCode: 0,
        activeLabel
      }
    }
    case 'for_each': {
      return runForEachNode(
        node.id,
        node.data,
        workflow,
        steps,
        primaryJson,
        runId,
        ops,
        signal,
        remoteExec
      )
    }
    case 'collect': {
      return { stdout: primaryOutput, stderr: '', outputValue: primaryJson, exitCode: 0 }
    }
    case 'form_input': {
      const r = runFormInputNode(node.data, steps)
      return { stdout: JSON.stringify(r.value), stderr: '', outputValue: r.value, exitCode: 0 }
    }
    case 'workflow_call': {
      if (signal.aborted) {
        throw new Error('Cancelled')
      }
      return runWorkflowCallNode(node.data, workflow.id, ops, signal, remoteExec)
    }
  }
}

// Register executeNode so the for_each runner can call it without a circular import.
registerExecuteNode(executeNode)
