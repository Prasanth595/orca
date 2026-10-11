import type { BranchData, BranchCondition } from '../../shared/workflow-types'

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
  input: { output: string; json: unknown; exitCode: number | null }
): boolean {
  let subject: unknown
  if (cond.field === 'exitCode') {
    subject = input.exitCode
  } else if (cond.field === 'output') {
    subject = input.output
  } else if (cond.field.startsWith('json.')) {
    subject = resolvePath(input.json, cond.field.slice(5))
  } else {
    subject = resolvePath(input.json, cond.field)
  }

  const s = String(subject ?? '')
  switch (cond.operator) {
    case 'exitCode0':
      return input.exitCode === 0
    case 'eq':
      return s === cond.value
    case 'neq':
      return s !== cond.value
    case 'contains':
      return s.includes(cond.value)
    case 'gt':
      return Number(subject) > Number(cond.value)
    case 'lt':
      return Number(subject) < Number(cond.value)
    case 'regex':
      return new RegExp(cond.value).test(s)
    case 'truthy':
      return Boolean(subject)
  }
}

/** Returns the label of the first matching condition, or `defaultLabel` if none match. */
export function evaluateBranchConditions(
  data: BranchData,
  input: { output: string; json: unknown; exitCode: number | null }
): string {
  for (const cond of data.conditions) {
    if (evalCondition(cond, input)) {
      return cond.label
    }
  }
  return data.defaultLabel
}
