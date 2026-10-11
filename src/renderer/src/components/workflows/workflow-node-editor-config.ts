import { translate } from '@/i18n/i18n'
import type { BranchConditionOperator } from '../../../../shared/workflow-types'

export function getMonacoFields(): Record<string, { language: string; label: string }> {
  return {
    script: { language: 'python', label: translate('workflows.nodeEditor.fieldScript', 'Script') },
    command: {
      language: 'shell',
      label: translate('workflows.nodeEditor.fieldCommand', 'Command')
    },
    expression: {
      // plaintext avoids JS-specific syntax highlights/errors for template expressions
      language: 'plaintext',
      label: translate('workflows.nodeEditor.fieldExpression', 'Expression')
    }
  }
}

export function getAvailableShells(isRemote: boolean): string[] {
  if (isRemote) {
    return ['bash', 'sh', 'zsh', 'tcsh', 'fish']
  }
  if (navigator.userAgent.includes('Win')) {
    return ['powershell', 'cmd']
  }
  if (navigator.userAgent.includes('Mac')) {
    return ['zsh', 'bash', 'sh']
  }
  return ['bash', 'sh', 'zsh', 'tcsh']
}

export const BRANCH_OPERATORS: { value: BranchConditionOperator; label: string }[] = [
  { value: 'exitCode0', label: 'exit code = 0' },
  { value: 'eq', label: '= (equals)' },
  { value: 'neq', label: '≠ (not equals)' },
  { value: 'contains', label: 'contains' },
  { value: 'gt', label: '> (greater than)' },
  { value: 'lt', label: '< (less than)' },
  { value: 'regex', label: 'matches regex' },
  { value: 'truthy', label: 'is truthy' }
]

export function operatorNeedsValue(op: BranchConditionOperator): boolean {
  return op !== 'exitCode0' && op !== 'truthy'
}

/**
 * Coerce localData string values back to the correct types for the node's data shape.
 * Handles booleans, numbers, and null-able string fields.
 */
export function coerceNodeData(rawData: Record<string, string>): Record<string, unknown> {
  const coerced: Record<string, unknown> = { ...rawData }
  if ('createParents' in coerced) {
    coerced['createParents'] = coerced['createParents'] !== 'false'
  }
  for (const k of ['timeoutSeconds', 'maxIterations', 'retryCount', 'retryDelaySeconds']) {
    if (k in coerced) {
      const n = Number(coerced[k])
      coerced[k] = Number.isNaN(n) ? 0 : n
    }
  }
  for (const k of [
    'smtpProfileId',
    'pythonBin',
    'shell',
    'structuredOutputSchema',
    'customExecutable',
    'customArgTemplate',
    'model'
  ]) {
    if (k in coerced && (coerced[k] === '' || coerced[k] === 'null')) {
      coerced[k] = null
    }
  }
  return coerced
}
