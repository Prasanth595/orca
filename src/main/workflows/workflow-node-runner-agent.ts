import { runProcess } from '../../shared/child-process/run-process'
import type { AgentCallData } from '../../shared/workflow-types'
import type { TuiAgent } from '../../shared/tui-agent'
import type { RemoteExecFn } from './workflow-remote-exec'

export type AgentNodeResult = {
  stdout: string
  stderr: string
  exitCode: number | null
}

/** Build a shell command string for a custom agent — used for both SSH and local (via sh -c). */
function buildCustomAgentCommand(data: AgentCallData, resolvedPrompt: string): string {
  const exe = data.customExecutable?.trim() || 'agent'
  const template = data.customArgTemplate ?? '{prompt}'
  const escapedPrompt = resolvedPrompt.replace(/'/g, `'\\''`)
  const args = template.includes('{prompt}')
    ? template.replace(/\{prompt\}/g, `'${escapedPrompt}'`)
    : `${template} '${escapedPrompt}'`
  return `${exe} ${args}`
}

function buildAgentArgs(
  agentId: TuiAgent | 'custom',
  prompt: string,
  structuredOutput: boolean,
  model?: string
): { program: string; args: string[] } {
  const modelArgs = model ? ['--model', model] : []
  if (agentId === 'claude') {
    return {
      program: 'claude',
      args: ['-p', ...modelArgs, ...(structuredOutput ? ['--output-format', 'json'] : []), prompt]
    }
  }
  if (agentId === 'codex') {
    return { program: 'codex', args: ['--quiet', ...modelArgs, prompt] }
  }
  if (agentId === 'gemini') {
    return { program: 'gemini', args: ['-p', ...modelArgs, prompt] }
  }
  if (agentId === 'amp') {
    return { program: 'amp', args: ['-p', ...modelArgs, prompt] }
  }
  if (agentId === 'opencode') {
    return { program: 'opencode', args: ['-p', ...modelArgs, prompt] }
  }
  // cursor-agent -p runs non-interactively (print mode), prompt is a positional arg
  return {
    program: 'cursor-agent',
    args: ['-p', ...modelArgs, ...(structuredOutput ? ['--output-format', 'json'] : []), prompt]
  }
}

/** Build a shell-safe single-string command for running an agent CLI over SSH. */
function buildAgentRemoteCommand(
  agentId: TuiAgent | 'custom',
  prompt: string,
  structuredOutput: boolean,
  model?: string,
  data?: AgentCallData
): string {
  if (agentId === 'custom' && data) {
    return buildCustomAgentCommand(data, prompt)
  }
  // Escape single-quotes in the prompt so it is safe inside '…'
  const escapedPrompt = prompt.replace(/'/g, `'\\''`)
  const modelFlag = model ? `--model ${model} ` : ''
  const jsonFlag = structuredOutput ? '--output-format json ' : ''
  if (agentId === 'claude') {
    return `claude -p ${modelFlag}${jsonFlag}'${escapedPrompt}'`
  }
  if (agentId === 'codex') {
    return `codex --quiet ${modelFlag}'${escapedPrompt}'`
  }
  if (agentId === 'gemini') {
    return `gemini -p ${modelFlag}'${escapedPrompt}'`
  }
  if (agentId === 'amp') {
    return `amp -p ${modelFlag}'${escapedPrompt}'`
  }
  if (agentId === 'opencode') {
    return `opencode -p ${modelFlag}'${escapedPrompt}'`
  }
  return `cursor-agent -p ${modelFlag}${jsonFlag}'${escapedPrompt}'`
}

export async function runAgentCallNode(
  data: AgentCallData,
  resolvedPrompt: string,
  remoteExec?: RemoteExecFn,
  signal?: AbortSignal
): Promise<AgentNodeResult> {
  if (remoteExec) {
    const command = buildAgentRemoteCommand(
      data.agentId,
      resolvedPrompt,
      data.structuredOutputSchema !== null,
      data.model,
      data
    )
    const result = await remoteExec(command, {
      signal,
      timeoutMs: data.timeoutSeconds * 1000
    })
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode }
  }
  if (data.agentId === 'custom') {
    // Custom agent: run the full command string through the platform shell
    const cmd = buildCustomAgentCommand(data, resolvedPrompt)
    const shellArgs: [string, string[]] =
      process.platform === 'win32' ? ['cmd.exe', ['/c', cmd]] : ['/bin/sh', ['-c', cmd]]
    const result = await runProcess({
      program: shellArgs[0],
      args: shellArgs[1],
      cwd: data.workingDirectory || undefined,
      timeoutMs: data.timeoutSeconds * 1000
    })
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.code }
  }
  const { program, args } = buildAgentArgs(
    data.agentId,
    resolvedPrompt,
    data.structuredOutputSchema !== null,
    data.model
  )
  const result = await runProcess({
    program,
    args,
    cwd: data.workingDirectory || undefined,
    timeoutMs: data.timeoutSeconds * 1000
  })
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.code }
}
