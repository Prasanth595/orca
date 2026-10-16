import { describe, expect, it } from 'vitest'
import {
  extractPythonSymbols,
  extractCSymbols,
  extractSVSymbols,
  symbolAtLine
} from './editor-symbol-extractor'

describe('extractPythonSymbols', () => {
  it('extracts top-level classes and functions', () => {
    const content = [
      'class Foo:',
      '    def bar(self):',
      '        pass',
      '',
      'def baz():',
      '    pass'
    ].join('\n')
    const syms = extractPythonSymbols(content)
    expect(syms.map((s) => s.name)).toEqual(['Foo', 'bar', 'baz'])
    expect(syms[0]!.kind).toBe('class')
    expect(syms[1]!.kind).toBe('method') // indented def → method
    expect(syms[2]!.kind).toBe('function') // top-level def → function
  })

  it('handles async def', () => {
    const content = 'async def fetch():\n    pass\n'
    const syms = extractPythonSymbols(content)
    expect(syms).toHaveLength(1)
    expect(syms[0]!.name).toBe('fetch')
    expect(syms[0]!.kind).toBe('function')
  })

  it('marks indented methods as method', () => {
    const content = [
      'class MyClass:',
      '    def __init__(self):',
      '        pass',
      '    async def run(self):',
      '        pass'
    ].join('\n')
    const syms = extractPythonSymbols(content)
    expect(syms.find((s) => s.name === '__init__')?.kind).toBe('method')
    expect(syms.find((s) => s.name === 'run')?.kind).toBe('method')
  })
})

describe('extractCSymbols', () => {
  it('extracts struct, class, union, enum, enum class', () => {
    const content = [
      'struct Point { int x; int y; };',
      'class Shape { public: virtual ~Shape(); };',
      'union Data { int i; float f; };',
      'enum Color { Red, Green, Blue };',
      'enum class Dir { North, South };'
    ].join('\n')
    const syms = extractCSymbols(content)
    expect(syms.find((s) => s.name === 'Point')?.kind).toBe('struct')
    expect(syms.find((s) => s.name === 'Shape')?.kind).toBe('class')
    expect(syms.find((s) => s.name === 'Data')?.kind).toBe('struct')
    expect(syms.find((s) => s.name === 'Color')?.kind).toBe('enum')
    expect(syms.find((s) => s.name === 'Dir')?.kind).toBe('enum')
  })

  it('extracts namespaces', () => {
    const content = 'namespace math {\n  int add(int a, int b);\n}\n'
    const syms = extractCSymbols(content)
    expect(syms.find((s) => s.name === 'math')?.kind).toBe('module')
  })

  it('extracts anonymous namespace', () => {
    const content = 'namespace {\n  static int counter = 0;\n}\n'
    const syms = extractCSymbols(content)
    expect(syms.find((s) => s.name === '(anonymous)')?.kind).toBe('module')
  })

  it('extracts function definitions', () => {
    const content = 'int add(int a, int b) {\n  return a + b;\n}\n'
    const syms = extractCSymbols(content)
    expect(syms.some((s) => s.name === 'add' && s.kind === 'function')).toBe(true)
  })

  it('extracts qualified method definitions as method', () => {
    const content = 'int MyClass::compute(int x) {\n  return x * 2;\n}\n'
    const syms = extractCSymbols(content)
    expect(syms.some((s) => s.name === 'MyClass::compute' && s.kind === 'method')).toBe(true)
  })

  it('extracts using type aliases', () => {
    const content = 'using StringMap = std::map<std::string, int>;\n'
    const syms = extractCSymbols(content)
    expect(syms.find((s) => s.name === 'StringMap')?.kind).toBe('variable')
  })

  it('extracts typedef declarations', () => {
    const content = 'typedef unsigned long long uint64;\n'
    const syms = extractCSymbols(content)
    expect(syms.find((s) => s.name === 'uint64')?.kind).toBe('variable')
  })

  it('extracts template class declarations', () => {
    const content = 'template<typename T>\nclass Stack {\n  T data;\n};\n'
    const syms = extractCSymbols(content)
    expect(syms.find((s) => s.name === 'Stack')?.kind).toBe('class')
  })
})

describe('extractSVSymbols', () => {
  it('extracts modules, classes, functions, tasks and enums', () => {
    const content = [
      'module adder(',
      '  input a, b,',
      '  output c',
      ');',
      '  class MyClass;',
      '    function automatic int add;',
      '      input int x;',
      '    endfunction',
      '    task drive;',
      '    endtask',
      '    enum logic [1:0] State {S0, S1};',
      '  endclass',
      'endmodule'
    ].join('\n')
    const syms = extractSVSymbols(content)
    expect(syms.find((s) => s.name === 'adder')?.kind).toBe('module')
    expect(syms.find((s) => s.name === 'MyClass')?.kind).toBe('class')
    expect(syms.find((s) => s.name === 'add')?.kind).toBe('function')
    expect(syms.find((s) => s.name === 'drive')?.kind).toBe('function')
    expect(syms.find((s) => s.name === 'State')?.kind).toBe('enum')
  })

  it('extracts interface, program, package and checker', () => {
    const content = [
      'interface bus_if;',
      '  logic clk;',
      'endinterface',
      'package my_pkg;',
      'endpackage'
    ].join('\n')
    const syms = extractSVSymbols(content)
    expect(syms.find((s) => s.name === 'bus_if')?.kind).toBe('module')
    expect(syms.find((s) => s.name === 'my_pkg')?.kind).toBe('module')
  })

  it('extracts always blocks with kind other', () => {
    const content = 'always_comb begin\n  y = a & b;\nend\n'
    const syms = extractSVSymbols(content)
    expect(syms.some((s) => s.kind === 'other')).toBe(true)
  })

  it('extracts covergroup', () => {
    const content = 'covergroup cg @(posedge clk);\nendgroup\n'
    const syms = extractSVSymbols(content)
    expect(syms.find((s) => s.name === 'cg')?.kind).toBe('module')
  })
})

describe('symbolAtLine', () => {
  it('returns the innermost symbol at a given line', () => {
    const syms = [
      { name: 'Foo', kind: 'class' as const, line: 1, endLine: 10 },
      { name: 'bar', kind: 'function' as const, line: 3, endLine: 7 }
    ]
    expect(symbolAtLine(syms, 5)?.name).toBe('bar')
    expect(symbolAtLine(syms, 9)?.name).toBe('Foo')
    expect(symbolAtLine(syms, 12)).toBeNull()
  })
})
