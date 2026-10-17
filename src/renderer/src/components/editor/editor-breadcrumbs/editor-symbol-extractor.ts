export type EditorSymbol = {
  name: string
  kind: 'class' | 'function' | 'method' | 'module' | 'struct' | 'enum' | 'variable' | 'other'
  line: number
  endLine: number
}

// ─── Python ──────────────────────────────────────────────────────────────────

// Captures: (1) indent, (2) keyword (class/def/async def), (3) name
const PYTHON_RE = /^([ \t]*)(async\s+def|def|class)\s+([A-Za-z_]\w*)/gm

export function extractPythonSymbols(content: string): EditorSymbol[] {
  const lines = content.split('\n')
  const symbols: EditorSymbol[] = []
  let m: RegExpExecArray | null
  PYTHON_RE.lastIndex = 0
  while ((m = PYTHON_RE.exec(content)) !== null) {
    const indent = m[1]!.length
    const isClass = m[2]!.startsWith('class')
    const name = m[3]!
    const lineNumber = content.slice(0, m.index).split('\n').length
    // kind: class → class, def at indent 0 → function, indented def → method
    const kind: EditorSymbol['kind'] = isClass ? 'class' : indent === 0 ? 'function' : 'method'
    // end: next non-blank line with equal-or-lesser indentation
    let endLine = lines.length
    for (let i = lineNumber; i < lines.length; i++) {
      const l = lines[i]!
      if (l.trim() === '') {
        continue
      }
      const ind = l.match(/^(\s*)/)?.[1]?.length ?? 0
      if (ind <= indent && i > lineNumber - 1) {
        endLine = i
        break
      }
    }
    symbols.push({ name, kind, line: lineNumber, endLine })
  }
  return symbols
}

// ─── C / C++ ─────────────────────────────────────────────────────────────────

// class/struct/union/enum/enum class — name before optional base-list or body
const C_TYPE_RE =
  /^[ \t]*(?:template\s*<[^>]*>\s*)?(class|struct|union|enum(?:\s+class)?)\s+(?:\w+\s+)*?(\w+)\s*(?:final\s*)?(?::[^{]*)?\{/gm

// namespace — including anonymous `namespace {`
const C_NS_RE = /^[ \t]*namespace\s+(?:(\w+)\s*)?\{/gm

// Function / method definitions (not declarations): return-type name( ... ) [cv] {
// Also handles constructor/destructor: Foo::Foo( ... ) { / Foo::~Foo( ... ) {
const C_FUNC_RE =
  /^(?:[ \t]*)(?:(?:template\s*<[^>]*>\s+)?(?:(?:static|inline|virtual|explicit|constexpr|override|final|[[nodiscard]]*)\s+)*(?!(?:if|for|while|switch|return|else|do|try|catch|throw|delete|new|case|default)\b)(?:[\w:*&<>[\],\s]+?)\s+)?(~?\w[\w:~]*)\s*\([^;{]*\)\s*(?:const\s*|volatile\s*|noexcept[^{]*)?\{/gm

// using TypeAlias = ... and typedef ... Name;
const C_ALIAS_RE = /^[ \t]*using\s+(\w+)\s*=/gm
const C_TYPEDEF_RE = /^[ \t]*typedef\s+.+?\s+(\w+)\s*;/gm

export function extractCSymbols(content: string): EditorSymbol[] {
  const lines = content.split('\n')
  const symbols: EditorSymbol[] = []
  const seen = new Set<number>()

  const addSymbol = (name: string, kind: EditorSymbol['kind'], matchIndex: number): void => {
    const lineNumber = content.slice(0, matchIndex).split('\n').length
    if (seen.has(lineNumber)) {
      return
    }
    seen.add(lineNumber)
    const endLine = parseRange(lines, lineNumber)
    symbols.push({ name, kind, line: lineNumber, endLine })
  }

  let m: RegExpExecArray | null

  // Types: class / struct / union / enum
  C_TYPE_RE.lastIndex = 0
  while ((m = C_TYPE_RE.exec(content)) !== null) {
    const kw = m[1]!
    const name = m[2]!
    const kind: EditorSymbol['kind'] =
      kw === 'struct' || kw === 'union' ? 'struct' : kw.startsWith('enum') ? 'enum' : 'class'
    addSymbol(name, kind, m.index)
  }

  // Namespaces
  C_NS_RE.lastIndex = 0
  while ((m = C_NS_RE.exec(content)) !== null) {
    addSymbol(m[1] ?? '(anonymous)', 'module', m.index)
  }

  // Functions / methods / constructors / destructors
  C_FUNC_RE.lastIndex = 0
  while ((m = C_FUNC_RE.exec(content)) !== null) {
    const name = m[1]
    if (!name) {
      continue
    }
    // Skip control-flow keywords that sneak through
    if (/^(?:if|for|while|switch|catch|do)$/.test(name)) {
      continue
    }
    // Method (qualified name Foo::bar) vs free function
    const kind: EditorSymbol['kind'] = name.includes('::') ? 'method' : 'function'
    addSymbol(name, kind, m.index)
  }

  // Type aliases
  C_ALIAS_RE.lastIndex = 0
  while ((m = C_ALIAS_RE.exec(content)) !== null) {
    addSymbol(m[1]!, 'variable', m.index)
  }

  C_TYPEDEF_RE.lastIndex = 0
  while ((m = C_TYPEDEF_RE.exec(content)) !== null) {
    addSymbol(m[1]!, 'variable', m.index)
  }

  return symbols.sort((a, b) => a.line - b.line)
}

// ─── SystemVerilog / Verilog ─────────────────────────────────────────────────

// SV built-in types that appear as return types on function/task declarations
const SV_BUILTIN_TYPES =
  'int|void|bit|logic|reg|wire|byte|shortint|longint|integer|time|real|shortreal|string|chandle|event|signed|unsigned'

// Group layout:
//   (1) block keyword (module/class/interface/program/checker/package/generate/covergroup)
//   (2) block name
//   (3) function|task keyword
//   (4) function|task name (after optional `automatic` + optional return-type word)
//   (5) enum keyword  (6) enum name
//   (7) always_*/initial (no captured name)
const SV_RE = new RegExp(
  String.raw`^[ \t]*(?:` +
    String.raw`(module|class|interface|program|checker|package|generate|covergroup)\s+([A-Za-z_]\w*)` +
    String.raw`|(function|task)\s+(?:automatic\s+)?(?:(?:${SV_BUILTIN_TYPES})\s+)?([A-Za-z_]\w*)` +
    String.raw`|(enum)\s+(?:(?:${SV_BUILTIN_TYPES})\s+(?:\[[^\]]*\]\s+)?)?([A-Za-z_]\w*)` +
    String.raw`|(always(?:_comb|_ff|_latch)?|initial)\s*(?:@\s*\([^)]*\))?` +
    String.raw`)`,
  'gm'
)

export function extractSVSymbols(content: string): EditorSymbol[] {
  const lines = content.split('\n')
  const symbols: EditorSymbol[] = []
  let m: RegExpExecArray | null
  SV_RE.lastIndex = 0
  while ((m = SV_RE.exec(content)) !== null) {
    // Groups: (1) block kw, (2) block name, (3) fn/task kw, (4) fn/task name,
    //         (5) enum kw, (6) enum name, (7) always/initial
    const blockKw = m[1]
    const funcKw = m[3]
    const enumKw = m[5]
    const alwaysKw = m[7]
    const name = m[2] ?? m[4] ?? m[6] ?? alwaysKw ?? 'always'
    const keyword = blockKw ?? funcKw ?? enumKw ?? alwaysKw ?? 'always'
    const lineNumber = content.slice(0, m.index).split('\n').length
    const kind: EditorSymbol['kind'] =
      keyword === 'module' ||
      keyword === 'interface' ||
      keyword === 'program' ||
      keyword === 'covergroup' ||
      keyword === 'package' ||
      keyword === 'checker' ||
      keyword === 'generate'
        ? 'module'
        : keyword === 'class'
          ? 'class'
          : keyword === 'function' || keyword === 'task'
            ? 'function'
            : keyword === 'enum'
              ? 'enum'
              : 'other'
    const endLine = parseRange(lines, lineNumber)
    symbols.push({ name: name!, kind, line: lineNumber, endLine })
  }
  return symbols
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

function parseRange(lines: string[], startLine: number): number {
  let depth = 0
  let inString = false
  let stringChar = ''
  for (let i = startLine - 1; i < lines.length; i++) {
    const line = lines[i]!
    for (let j = 0; j < line.length; j++) {
      const ch = line[j]!
      if (inString) {
        if (ch === stringChar && line[j - 1] !== '\\') {
          inString = false
        }
      } else {
        if (ch === '"' || ch === "'") {
          inString = true
          stringChar = ch
        } else if (ch === '{') {
          depth++
        } else if (ch === '}') {
          depth--
          if (depth === 0) {
            return i + 1
          }
        }
      }
    }
  }
  return lines.length
}

export function extractSymbols(languageId: string, content: string): EditorSymbol[] {
  if (languageId === 'python') {
    return extractPythonSymbols(content)
  }
  if (languageId === 'c' || languageId === 'cpp') {
    return extractCSymbols(content)
  }
  if (languageId === 'systemverilog' || languageId === 'verilog') {
    return extractSVSymbols(content)
  }
  return []
}

export function symbolAtLine(symbols: EditorSymbol[], line: number): EditorSymbol | null {
  let best: EditorSymbol | null = null
  for (const sym of symbols) {
    if (sym.line <= line && sym.endLine >= line) {
      if (!best || sym.line > best.line) {
        best = sym
      }
    }
  }
  return best
}
