import type { BranchConditionOperator, WorkflowEdge, WorkflowNode } from './workflow-types'
import type { HttpRequestData } from './workflow-http-request-types'
import { defaultHttpRequestData } from './workflow-http-request-defaults'

const pos = (x: number, y: number) => ({ x, y })
export const trigger = (id: string, x: number, y: number): WorkflowNode => ({
  id,
  type: 'trigger_manual',
  pos: pos(x, y),
  data: {}
})
export const shell = (
  id: string,
  x: number,
  y: number,
  command: string,
  timeout = 10
): WorkflowNode => ({
  id,
  type: 'shell_command',
  pos: pos(x, y),
  data: { command, workingDirectory: '', timeoutSeconds: timeout, shell: 'bash' }
})
export const python = (
  id: string,
  x: number,
  y: number,
  script: string,
  timeout = 10
): WorkflowNode => ({
  id,
  type: 'python_script',
  pos: pos(x, y),
  data: { script, workingDirectory: '', timeoutSeconds: timeout, pythonBin: 'python3' }
})
export const fw = (
  id: string,
  x: number,
  y: number,
  filePath: string,
  content: string
): WorkflowNode => ({
  id,
  type: 'file_write',
  pos: pos(x, y),
  data: { filePath, content, mode: 'overwrite', createParents: true }
})
export const fr = (id: string, x: number, y: number, filePath: string): WorkflowNode => ({
  id,
  type: 'file_read',
  pos: pos(x, y),
  data: { filePath }
})
export const forEach = (id: string, x: number, y: number, expr: string): WorkflowNode => ({
  id,
  type: 'for_each',
  pos: pos(x, y),
  data: { itemsExpression: expr, maxIterations: 20 }
})
export const collect = (id: string, x: number, y: number): WorkflowNode => ({
  id,
  type: 'collect',
  pos: pos(x, y),
  data: {}
})
export const branch1 = (
  id: string,
  x: number,
  y: number,
  label: string,
  field: string,
  operator: BranchConditionOperator,
  value: string,
  defaultLabel: string
): WorkflowNode => ({
  id,
  type: 'branch',
  pos: pos(x, y),
  data: { conditions: [{ label, field, operator, value }], defaultLabel }
})
export const edge = (id: string, s: string, t: string, sel?: string): WorkflowEdge => ({
  id,
  sourceNodeId: s,
  targetNodeId: t,
  ...(sel ? { outputSelector: sel } : {})
})

/** HTTP Request node; unspecified fields take the node defaults. */
export const httpRequest = (
  id: string,
  x: number,
  y: number,
  data: Partial<HttpRequestData>
): WorkflowNode => ({
  id,
  type: 'http_request',
  pos: pos(x, y),
  data: { ...defaultHttpRequestData(), ...data }
})
