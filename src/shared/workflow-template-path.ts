export type JsonPath = (string | number)[]

export function buildTemplateExpr(nodeId: string, path: JsonPath): string {
  if (path.length === 0) {
    return `{{steps.${nodeId}.output}}`
  }
  const dotPath = path
    .map((seg, i) => (typeof seg === 'number' ? `[${seg}]` : i === 0 ? seg : `.${seg}`))
    .join('')
  return `{{steps.${nodeId}.json.${dotPath}}}`
}

export function resolveTemplateExpr(
  expr: string,
  steps: Record<string, { output: string; json: unknown }>,
  vars: Record<string, string> = {}
): string {
  return expr.replace(/\{\{([^}]+)\}\}/g, (match, path: string) => {
    const trimmed = path.trim()

    // Handle {{$vars.KEY}}
    if (trimmed.startsWith('$vars.')) {
      const key = trimmed.slice(6)
      return key in vars ? vars[key]! : match
    }

    const parts = trimmed.split('.')
    if (parts.length < 2) {
      return match
    }

    // Handle {{loop.item}}, {{loop.item.field}}, {{loop.index}}
    if (parts[0] === 'loop') {
      const loopStep = steps['__loop__']
      if (!loopStep) {
        return match
      }
      if (parts[1] === 'index') {
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: __loop__ json is always { item, index } written by the executor
        return String((loopStep.json as { index?: number } | null)?.index ?? 0)
      }
      if (parts[1] === 'item') {
        if (parts.length === 2) {
          return loopStep.output
        }
        // {{loop.item.field.nested}}
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: same as above
        let value: unknown = (loopStep.json as { item?: unknown } | null)?.item
        for (let i = 2; i < parts.length; i++) {
          if (value === null || typeof value !== 'object') {
            return match
          }
          const seg = parts[i]!
          const arrMatch = seg.match(/^(.+)\[(\d+)\]$/)
          if (arrMatch) {
            const key = arrMatch[1]!
            const idx = Number(arrMatch[2])
            // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: traversing unknown JSON at runtime
            value = (value as Record<string, unknown[]>)[key]?.[idx]
          } else {
            // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: same as above
            value = (value as Record<string, unknown>)[seg]
          }
          if (value === undefined) {
            return match
          }
        }
        return value === null ? 'null' : String(value)
      }
      return match
    }

    if (parts[0] !== 'steps' || parts.length < 3) {
      return match
    }
    const nodeId = parts[1]
    const step = steps[nodeId!]
    if (!step) {
      return match
    }
    if (parts[2] === 'output') {
      return step.output
    }
    if (parts[2] === 'json') {
      let value: unknown = step.json
      for (let i = 3; i < parts.length; i++) {
        if (value === null || typeof value !== 'object') {
          return match
        }
        const seg = parts[i]!
        const arrMatch = seg.match(/^(.+)\[(\d+)\]$/)
        if (arrMatch) {
          const key = arrMatch[1]!
          const idx = Number(arrMatch[2])
          // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: traversing unknown JSON at runtime; shape verified by narrowing above
          value = (value as Record<string, unknown[]>)[key]?.[idx]
        } else {
          // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: same as above
          value = (value as Record<string, unknown>)[seg]
        }
        if (value === undefined) {
          return match
        }
      }
      return value === null ? 'null' : String(value)
    }
    return match
  })
}

/** Resolves templates in every string nested inside `value`, preserving its shape. */
export function resolveTemplatesDeep<T>(
  value: T,
  steps: Record<string, { output: string; json: unknown }>,
  vars: Record<string, string> = {}
): T {
  if (typeof value === 'string') {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: T is string in this branch
    return resolveTemplateExpr(value, steps, vars) as T
  }
  if (Array.isArray(value)) {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: mapping preserves element shape
    return value.map((v: unknown) => resolveTemplatesDeep(v, steps, vars)) as T
  }
  if (value !== null && typeof value === 'object') {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: rebuilds the same keys with same-shaped values
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, resolveTemplatesDeep(v, steps, vars)])
    ) as T
  }
  return value
}
