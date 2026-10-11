import {
  Clock,
  Play,
  Terminal,
  Code2,
  Bot,
  FileText,
  FilePen,
  Mail,
  Braces,
  GitBranch,
  Repeat,
  Layers,
  type LucideIcon
} from 'lucide-react'
import type { WorkflowNode, WorkflowNodeType } from '../../../../shared/workflow-types'

function defaultShell(): string {
  if (navigator.userAgent.includes('Win')) {
    return 'powershell'
  }
  if (navigator.userAgent.includes('Mac')) {
    return 'zsh'
  }
  return 'bash'
}

export const NODE_TYPE_LABELS: Record<WorkflowNodeType, string> = {
  trigger_cron: 'Cron Trigger',
  trigger_manual: 'Manual Trigger',
  shell_command: 'Shell Command',
  python_script: 'Python Script',
  agent_call: 'Agent Call',
  file_read: 'File Read',
  file_write: 'File Write',
  email_send: 'Email Send',
  json_transform: 'JSON Transform',
  branch: 'Branch',
  for_each: 'For Each',
  collect: 'Collect'
}

export const NODE_TYPE_ICON_COLORS: Record<WorkflowNodeType, string> = {
  trigger_cron: 'text-violet-500',
  trigger_manual: 'text-violet-500',
  shell_command: 'text-slate-500',
  python_script: 'text-blue-500',
  agent_call: 'text-emerald-500',
  file_read: 'text-amber-500',
  file_write: 'text-orange-500',
  email_send: 'text-pink-500',
  json_transform: 'text-cyan-500',
  branch: 'text-yellow-500',
  for_each: 'text-teal-500',
  collect: 'text-indigo-500'
}

export const NODE_TYPE_ICONS: Record<WorkflowNodeType, LucideIcon> = {
  trigger_cron: Clock,
  trigger_manual: Play,
  shell_command: Terminal,
  python_script: Code2,
  agent_call: Bot,
  file_read: FileText,
  file_write: FilePen,
  email_send: Mail,
  json_transform: Braces,
  branch: GitBranch,
  for_each: Repeat,
  collect: Layers
}

export const NODE_TYPE_COLORS: Record<WorkflowNodeType, string> = {
  trigger_cron: 'border-violet-400 bg-violet-50 dark:bg-violet-950/30',
  trigger_manual: 'border-violet-400 bg-violet-50 dark:bg-violet-950/30',
  shell_command: 'border-slate-400 bg-slate-50 dark:bg-slate-900/30',
  python_script: 'border-blue-400 bg-blue-50 dark:bg-blue-950/30',
  agent_call: 'border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30',
  file_read: 'border-amber-400 bg-amber-50 dark:bg-amber-950/30',
  file_write: 'border-orange-400 bg-orange-50 dark:bg-orange-950/30',
  email_send: 'border-pink-400 bg-pink-50 dark:bg-pink-950/30',
  json_transform: 'border-cyan-400 bg-cyan-50 dark:bg-cyan-950/30',
  branch: 'border-yellow-400 bg-yellow-50 dark:bg-yellow-950/30',
  for_each: 'border-teal-400 bg-teal-50 dark:bg-teal-950/30',
  collect: 'border-indigo-400 bg-indigo-50 dark:bg-indigo-950/30'
}

export function nodeLabel(node: WorkflowNode): string {
  switch (node.type) {
    case 'shell_command':
      return node.label || node.data.command || node.id.slice(0, 8)
    case 'python_script':
      return node.label || node.data.script.slice(0, 30) || node.id.slice(0, 8)
    case 'agent_call':
      return node.label || node.data.prompt.slice(0, 30) || node.id.slice(0, 8)
    case 'file_read':
      return node.label || node.data.filePath || node.id.slice(0, 8)
    case 'file_write':
      return node.label || node.data.filePath || node.id.slice(0, 8)
    case 'trigger_cron':
      return node.label || node.data.schedule || node.id.slice(0, 8)
    case 'trigger_manual':
      return node.label || 'Manual'
    case 'email_send':
      return node.label || node.data.to || node.id.slice(0, 8)
    case 'json_transform':
      return node.label || node.data.expression.slice(0, 30) || node.id.slice(0, 8)
    case 'branch':
      return node.label || `Branch (${node.data.conditions.length} conditions)`
    case 'for_each':
      return node.label || node.data.itemsExpression || 'For Each'
    case 'collect':
      return node.label || 'Collect'
  }
}

export const ADD_NODE_TYPES: WorkflowNodeType[] = [
  'trigger_cron',
  'trigger_manual',
  'shell_command',
  'python_script',
  'agent_call',
  'file_read',
  'file_write',
  'email_send',
  'json_transform',
  'branch',
  'for_each',
  'collect'
]

export const TRIGGER_NODE_TYPES: WorkflowNodeType[] = ['trigger_manual', 'trigger_cron']

export const ACTION_NODE_TYPES: WorkflowNodeType[] = [
  'shell_command',
  'python_script',
  'agent_call',
  'file_read',
  'file_write',
  'json_transform',
  'email_send',
  'branch',
  'for_each',
  'collect'
]

export function buildDefaultNode(
  id: string,
  type: WorkflowNodeType,
  pos: { x: number; y: number }
): WorkflowNode {
  switch (type) {
    case 'trigger_cron':
      return { id, type, pos, data: { schedule: '0 8 * * *' } }
    case 'trigger_manual':
      return { id, type, pos, data: {} }
    case 'shell_command':
      return {
        id,
        type,
        pos,
        data: { command: '', workingDirectory: '', timeoutSeconds: 30, shell: defaultShell() }
      }
    case 'python_script':
      return {
        id,
        type,
        pos,
        data: { script: '', workingDirectory: '', timeoutSeconds: 30, pythonBin: 'python3' }
      }
    case 'agent_call':
      return {
        id,
        type,
        pos,
        data: {
          prompt: '',
          agentId: 'cursor',
          structuredOutputSchema: null,
          workingDirectory: '',
          timeoutSeconds: 120
        }
      }
    case 'file_read':
      return { id, type, pos, data: { filePath: '' } }
    case 'file_write':
      return {
        id,
        type,
        pos,
        data: { filePath: '', content: '', mode: 'overwrite', createParents: true }
      }
    case 'email_send':
      return { id, type, pos, data: { to: '', subject: '', body: '', smtpProfileId: null } }
    case 'json_transform':
      return { id, type, pos, data: { expression: '' } }
    case 'branch':
      return {
        id,
        type,
        pos,
        data: {
          conditions: [{ label: 'success', field: 'exitCode', operator: 'exitCode0', value: '' }],
          defaultLabel: 'otherwise'
        }
      }
    case 'for_each':
      return { id, type, pos, data: { itemsExpression: '', maxIterations: 100 } }
    case 'collect':
      return { id, type, pos, data: {} }
  }
}
