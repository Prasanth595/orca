import type { FormInputData } from '../../shared/workflow-types'

export function runFormInputNode(data: FormInputData): { value: Record<string, unknown> } {
  const out: Record<string, unknown> = {}
  for (const field of data.fields) {
    const key = field.label || field.id
    switch (field.type) {
      case 'string':
        out[key] = field.value
        break
      case 'number': {
        if (field.value.trim() === '') {
          out[key] = null
          break
        }
        const n = Number(field.value)
        out[key] = Number.isNaN(n) ? null : n
        break
      }
      case 'multi_choice':
        out[key] = field.value
        break
      case 'json':
        try {
          out[key] = JSON.parse(field.value)
        } catch {
          out[key] = field.value
        }
        break
    }
  }
  return { value: out }
}
