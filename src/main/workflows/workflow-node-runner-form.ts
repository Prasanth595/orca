import type { FormInputData, StepOutputs } from '../../shared/workflow-types'
import { resolveTemplateExpr } from '../../shared/workflow-template-path'

export function runFormInputNode(
  data: FormInputData,
  steps: StepOutputs = {}
): { value: Record<string, unknown> } {
  const out: Record<string, unknown> = {}
  for (const field of data.fields) {
    const key = field.label || field.id
    const raw = resolveTemplateExpr(field.value, steps)
    switch (field.type) {
      case 'string':
        out[key] = raw
        break
      case 'number': {
        if (raw.trim() === '') {
          out[key] = null
          break
        }
        const n = Number(raw)
        out[key] = Number.isNaN(n) ? null : n
        break
      }
      case 'multi_choice':
        out[key] = raw
        break
      case 'json':
        try {
          out[key] = JSON.parse(raw)
        } catch {
          out[key] = raw
        }
        break
    }
  }
  return { value: out }
}
