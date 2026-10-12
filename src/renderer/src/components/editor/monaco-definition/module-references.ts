export type ModuleReference = {
  specifier: string
  /** Re-exports and triple-slash references pass declarations through, so their targets must load too. */
  reexport: boolean
}

// Why bounded: a semicolon-free file would otherwise rescan to the next quote from every `import`/`export`.
const FROM_CLAUSE = /\b(import|export)\s+(?:type\s+)?[^'"`;]{0,2000}?\bfrom\s*['"]([^'"\r\n]+)['"]/g
const SIDE_EFFECT_IMPORT = /\bimport\s*['"]([^'"\r\n]+)['"]/g
const CALL_IMPORT = /\b(?:import|require)\s*\(\s*['"]([^'"\r\n]+)['"]\s*\)/g
const TRIPLE_SLASH_REFERENCE = /^\/\/\/\s*<reference\s+(path|types)\s*=\s*['"]([^'"\r\n]+)['"]/gm

/** Lexical scan, not a parse: a match inside a comment or string only costs one extra prefetch. */
export function extractModuleReferences(sourceText: string): ModuleReference[] {
  const references = new Map<string, boolean>()
  const add = (specifier: string, reexport: boolean): void => {
    references.set(specifier, reexport || (references.get(specifier) ?? false))
  }
  for (const match of sourceText.matchAll(FROM_CLAUSE)) {
    add(match[2], match[1] === 'export')
  }
  for (const match of sourceText.matchAll(SIDE_EFFECT_IMPORT)) {
    add(match[1], false)
  }
  for (const match of sourceText.matchAll(CALL_IMPORT)) {
    add(match[1], false)
  }
  for (const match of sourceText.matchAll(TRIPLE_SLASH_REFERENCE)) {
    const [, kind, target] = match
    add(kind === 'path' && !target.startsWith('.') ? `./${target}` : target, true)
  }
  return Array.from(references, ([specifier, reexport]) => ({ specifier, reexport }))
}
