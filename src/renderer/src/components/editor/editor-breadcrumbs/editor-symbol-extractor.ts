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

// ─── TypeScript / JavaScript ─────────────────────────────────────────────────

// Class declaration: optional export/abstract/declare
const TS_CLASS_RE =
  /^([ \t]*)(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/gm

// Function declaration: optional export/async/generator
const TS_FUNC_RE =
  /^([ \t]*)(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*[(<]/gm

// Const/let/var arrow or function expression assigned to an identifier
// Matches: [export] const Foo = [async] ([...]) => | [async] function
const TS_ARROW_RE =
  /^([ \t]*)(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?\s*=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/gm

// Interface declaration
const TS_IFACE_RE = /^([ \t]*)(?:export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)/gm

// Type alias: export? type Foo = ...
const TS_TYPE_RE = /^([ \t]*)(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*[=<]/gm

// Enum: export? const? enum Foo
const TS_ENUM_RE = /^([ \t]*)(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/gm

// Class method: indented identifier followed by ( — guards against control-flow keywords
const TS_METHOD_RE =
  /^([ \t]+)(?:(?:public|private|protected|static|async|override|abstract|readonly|get|set)\s+)*([A-Za-z_$][\w$]*)\s*[(<]/gm

const TS_CONTROL_FLOW = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'do',
  'return',
  'throw',
  'new',
  'delete',
  'typeof',
  'void',
  'instanceof',
  'in',
  'of',
  'case',
  'default',
  'break',
  'continue',
  'import',
  'from',
  'await',
  'yield',
  'super',
  'this'
])

export function extractTypeScriptSymbols(content: string): EditorSymbol[] {
  const lines = content.split('\n')
  const seen = new Set<number>()
  const symbols: EditorSymbol[] = []

  const add = (name: string, kind: EditorSymbol['kind'], matchIndex: number): void => {
    const lineNumber = content.slice(0, matchIndex).split('\n').length
    if (seen.has(lineNumber)) {
      return
    }
    seen.add(lineNumber)
    const endLine = parseRange(lines, lineNumber)
    symbols.push({ name, kind, line: lineNumber, endLine })
  }

  let m: RegExpExecArray | null

  // Classes
  TS_CLASS_RE.lastIndex = 0
  while ((m = TS_CLASS_RE.exec(content)) !== null) {
    add(m[2]!, 'class', m.index)
  }

  // Function declarations
  TS_FUNC_RE.lastIndex = 0
  while ((m = TS_FUNC_RE.exec(content)) !== null) {
    const indent = m[1]!.length
    add(m[2]!, indent === 0 ? 'function' : 'method', m.index)
  }

  // Arrow / function expressions assigned to a name
  TS_ARROW_RE.lastIndex = 0
  while ((m = TS_ARROW_RE.exec(content)) !== null) {
    const indent = m[1]!.length
    add(m[2]!, indent === 0 ? 'function' : 'method', m.index)
  }

  // Interfaces (mapped to 'class' — structurally equivalent for navigation)
  TS_IFACE_RE.lastIndex = 0
  while ((m = TS_IFACE_RE.exec(content)) !== null) {
    add(m[2]!, 'class', m.index)
  }

  // Type aliases
  TS_TYPE_RE.lastIndex = 0
  while ((m = TS_TYPE_RE.exec(content)) !== null) {
    add(m[2]!, 'variable', m.index)
  }

  // Enums
  TS_ENUM_RE.lastIndex = 0
  while ((m = TS_ENUM_RE.exec(content)) !== null) {
    add(m[2]!, 'enum', m.index)
  }

  // Class methods (indented, not already captured)
  TS_METHOD_RE.lastIndex = 0
  while ((m = TS_METHOD_RE.exec(content)) !== null) {
    const name = m[2]!
    if (TS_CONTROL_FLOW.has(name) || name === 'constructor') {
      continue
    }
    add(name, 'method', m.index)
  }

  return symbols.sort((a, b) => a.line - b.line)
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
  if (
    languageId === 'typescript' ||
    languageId === 'javascript' ||
    languageId === 'typescriptreact' ||
    languageId === 'javascriptreact'
  ) {
    return extractTypeScriptSymbols(content)
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
