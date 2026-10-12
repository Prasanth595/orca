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
  | 'branch'
  | 'for_each'
  | 'collect'
  | 'form_input'

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

export type BranchConditionOperator =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'gt'
  | 'lt'
  | 'exitCode0'
  | 'regex'
  | 'truthy'

export type BranchCondition = {
  /** Edge output label this condition fires when true ("success", "failure", etc.) */
  label: string
  /** Dot-path to evaluate: 'exitCode' | 'output' | 'json.field.path' */
  field: string
  operator: BranchConditionOperator
  /** RHS value (empty for exitCode0 / truthy operators) */
  value: string
}

export type BranchData = {
  conditions: BranchCondition[]
  /** Label fired when no condition matches */
  defaultLabel: string
}

export type ForEachData = {
  /** Template expression resolving to a JSON array, e.g. {{steps.nodeId.json.items}} */
  itemsExpression: string
  /** Safety cap to prevent runaway loops */
  maxIterations: number
}

/** Marker node — terminates a ForEach loop body. Collects iteration outputs into an array. */
export type CollectData = Record<string, never>

export type FormFieldType = 'string' | 'number' | 'multi_choice' | 'json'

export type FormInputField = {
  id: string
  /** Key used in the output JSON object */
  label: string
  type: FormFieldType
  /** Stored as a string; parsed at execution time according to `type` */
  value: string
  /** For multi_choice: newline-separated option strings */
  options?: string
}

export type FormInputData = {
  fields: FormInputField[]
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
  | BranchData
  | ForEachData
  | CollectData
  | FormInputData

// ─── Node ────────────────────────────────────────────────────────────────────

export type Vec2 = { x: number; y: number }

// label: optional user-defined display name (overrides content-derived canvas label)
// retryCount / retryDelaySeconds: action-node retry config; ignored by triggers, branch, collect

export type WorkflowNode =
  | { id: string; type: 'trigger_cron'; pos: Vec2; data: TriggerCronData; label?: string }
  | { id: string; type: 'trigger_manual'; pos: Vec2; data: TriggerManualData; label?: string }
  | {
      id: string
      type: 'shell_command'
      pos: Vec2
      data: ShellCommandData
      label?: string
      retryCount?: number
      retryDelaySeconds?: number
    }
  | {
      id: string
      type: 'python_script'
      pos: Vec2
      data: PythonScriptData
      label?: string
      retryCount?: number
      retryDelaySeconds?: number
    }
  | {
      id: string
      type: 'agent_call'
      pos: Vec2
      data: AgentCallData
      label?: string
      retryCount?: number
      retryDelaySeconds?: number
    }
  | {
      id: string
      type: 'file_read'
      pos: Vec2
      data: FileReadData
      label?: string
      retryCount?: number
      retryDelaySeconds?: number
    }
  | {
      id: string
      type: 'file_write'
      pos: Vec2
      data: FileWriteData
      label?: string
      retryCount?: number
      retryDelaySeconds?: number
    }
  | {
      id: string
      type: 'email_send'
      pos: Vec2
      data: EmailSendData
      label?: string
      retryCount?: number
      retryDelaySeconds?: number
    }
  | {
      id: string
      type: 'json_transform'
      pos: Vec2
      data: JsonTransformData
      label?: string
      retryCount?: number
      retryDelaySeconds?: number
    }
  | { id: string; type: 'branch'; pos: Vec2; data: BranchData; label?: string }
  | { id: string; type: 'for_each'; pos: Vec2; data: ForEachData; label?: string }
  | { id: string; type: 'collect'; pos: Vec2; data: CollectData; label?: string }
  | { id: string; type: 'form_input'; pos: Vec2; data: FormInputData; label?: string }

// ─── Edge ────────────────────────────────────────────────────────────────────

export type WorkflowEdge = {
  id: string
  sourceNodeId: string
  targetNodeId: string
  /**
   * Condition label for branch output ports ("success", "failure", "otherwise").
   * Body/done labels for for_each output ports ("body", "done").
   * Unset on regular edges.
   */
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
  retryAttempt?: number
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

/** Map of nodeId → last-run outputs, threaded through the executor to resolve {{}} templates. */
export type StepOutputs = Record<string, { output: string; json: unknown }>

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
