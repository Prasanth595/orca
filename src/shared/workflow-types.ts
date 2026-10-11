import type { TuiAgent } from './tui-agent'

// ─── Node type discriminants ─────────────────────────────────────────────────

export type WorkflowNodeType =
  | 'trigger_cron'
  | 'trigger_manual'
  | 'shell_command'
  | 'python_script'
  | 'agent_call'
  | 'file_read'
  | 'file_write'
  | 'email_send'
  | 'json_transform'

// ─── Node data shapes ────────────────────────────────────────────────────────

export type TriggerCronData = { schedule: string }
export type TriggerManualData = Record<string, never>

export type ShellCommandData = {
  command: string
  workingDirectory: string
  timeoutSeconds: number
  shell?: string
  env?: Record<string, string>
}

export type PythonScriptData = {
  script: string
  workingDirectory: string
  timeoutSeconds: number
  pythonBin?: string
}

export type AgentCallData = {
  agentId: TuiAgent | 'custom'
  model?: string
  prompt: string
  structuredOutputSchema: string | null
  workingDirectory: string
  timeoutSeconds: number
  /** Used when agentId === 'custom': path to the agent executable. */
  customExecutable?: string
  /** Used when agentId === 'custom': arg template where {prompt} is replaced with the resolved prompt. */
  customArgTemplate?: string
}

export type FileReadData = {
  filePath: string
}

export type FileWriteData = {
  filePath: string
  content: string
  mode: 'overwrite' | 'append'
  createParents: boolean
}

export type EmailSendData = {
  to: string
  subject: string
  body: string
  smtpProfileId: string | null
}

export type JsonTransformData = {
  expression: string
}

export type WorkflowNodeData =
  | TriggerCronData
  | TriggerManualData
  | ShellCommandData
  | PythonScriptData
  | AgentCallData
  | FileReadData
  | FileWriteData
  | EmailSendData
  | JsonTransformData

// ─── Node ────────────────────────────────────────────────────────────────────

export type Vec2 = { x: number; y: number }

export type WorkflowNode =
  | { id: string; type: 'trigger_cron'; pos: Vec2; data: TriggerCronData }
  | { id: string; type: 'trigger_manual'; pos: Vec2; data: TriggerManualData }
  | { id: string; type: 'shell_command'; pos: Vec2; data: ShellCommandData }
  | { id: string; type: 'python_script'; pos: Vec2; data: PythonScriptData }
  | { id: string; type: 'agent_call'; pos: Vec2; data: AgentCallData }
  | { id: string; type: 'file_read'; pos: Vec2; data: FileReadData }
  | { id: string; type: 'file_write'; pos: Vec2; data: FileWriteData }
  | { id: string; type: 'email_send'; pos: Vec2; data: EmailSendData }
  | { id: string; type: 'json_transform'; pos: Vec2; data: JsonTransformData }

// ─── Edge ────────────────────────────────────────────────────────────────────

export type WorkflowEdge = {
  id: string
  sourceNodeId: string
  targetNodeId: string
  outputSelector?: string
}

// ─── Workflow ─────────────────────────────────────────────────────────────────

export type AgentWorkflow = {
  id: string
  name: string
  description: string
  schedule: string | null
  enabled: boolean
  executionTargetType: 'local' | 'ssh'
  executionTargetId: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  createdAt: number
  updatedAt: number
}

// ─── Run records ─────────────────────────────────────────────────────────────

export type WorkflowRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export type WorkflowNodeRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

export type WorkflowNodeRun = {
  nodeId: string
  nodeType: WorkflowNodeType
  status: WorkflowNodeRunStatus
  startedAt: number | null
  completedAt: number | null
  stdout: string | null
  stderr: string | null
  outputValue: unknown
  error: string | null
  durationMs: number | null
}

export type WorkflowRun = {
  id: string
  workflowId: string
  trigger: 'scheduled' | 'manual'
  status: WorkflowRunStatus
  startedAt: number
  completedAt: number | null
  error: string | null
  nodeRuns: WorkflowNodeRun[]
}

export function isFinalWorkflowRunStatus(status: WorkflowRunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

// ─── Default agent ───────────────────────────────────────────────────────────

export const DEFAULT_WORKFLOW_AGENT_ID: TuiAgent = 'cursor'

export function defaultAgentCallData(): AgentCallData {
  return {
    agentId: DEFAULT_WORKFLOW_AGENT_ID,
    prompt: '',
    structuredOutputSchema: null,
    workingDirectory: '',
    timeoutSeconds: 300
  }
}
