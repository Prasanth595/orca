import type { BranchData, BranchCondition, StepOutputs } from '../../shared/workflow-types'
import { resolveTemplateExpr } from '../../shared/workflow-template-path'

function resolvePath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((v, k) => {
    if (v == null || typeof v !== 'object') {
      return undefined
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: traversing unknown JSON at runtime
    return (v as Record<string, unknown>)[k]
  }, obj)
}

function evalCondition(
  cond: BranchCondition,
  input: { output: string; json: unknown; exitCode: number | null },
  steps: StepOutputs
): boolean {
  let subject: unknown
  if (cond.field === 'exitCode') {
    subject = input.exitCode
  } else if (cond.field === 'output') {
    subject = input.output
  } else if (cond.field.startsWith('json.')) {
    subject = resolvePath(input.json, cond.field.slice(5))
  } else if (cond.field.includes('{{')) {
    // Custom field with template expression — resolve against all step outputs
    subject = resolveTemplateExpr(cond.field, steps)
  } else {
    subject = resolvePath(input.json, cond.field)
  }

  const s = String(subject ?? '')
  // Resolve {{}} in the comparison value too
  const value = resolveTemplateExpr(cond.value, steps)

  switch (cond.operator) {
    case 'exitCode0':
      return input.exitCode === 0
    case 'eq':
      return s === value
    case 'neq':
      return s !== value
    case 'contains':
      return s.includes(value)
    case 'gt':
      return Number(subject) > Number(value)
    case 'lt':
      return Number(subject) < Number(value)
    case 'regex':
      return new RegExp(value).test(s)
    case 'truthy':
      return Boolean(subject)
  }
}

/** Returns the label of the first matching condition, or `defaultLabel` if none match. */
export function evaluateBranchConditions(
  data: BranchData,
  input: { output: string; json: unknown; exitCode: number | null },
  steps: StepOutputs
): string {
  for (const cond of data.conditions) {
    if (evalCondition(cond, input, steps)) {
      return cond.label
    }
  }
  return data.defaultLabel
}
