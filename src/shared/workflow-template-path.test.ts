import { describe, it, expect } from 'vitest'
import {
  resolveTemplateExpr,
  buildTemplateExpr,
  resolveTemplatesDeep
} from './workflow-template-path'

const STEPS = {
  n1: { output: 'hello', json: { field: 'value', nested: { deep: 42 }, arr: ['x', 'y'] } }
}

describe('resolveTemplateExpr', () => {
  it('resolves steps.id.output to the output string', () => {
    expect(resolveTemplateExpr('{{steps.n1.output}}', STEPS)).toBe('hello')
  })

  it('resolves steps.id.json.field to a nested value', () => {
    expect(resolveTemplateExpr('{{steps.n1.json.field}}', STEPS)).toBe('value')
  })

  it('resolves deeply nested json path', () => {
    expect(resolveTemplateExpr('{{steps.n1.json.nested.deep}}', STEPS)).toBe('42')
  })

  it('resolves array index access', () => {
    expect(resolveTemplateExpr('{{steps.n1.json.arr[0]}}', STEPS)).toBe('x')
  })

  it('returns literal unchanged when node id is unknown', () => {
    expect(resolveTemplateExpr('{{steps.missing.output}}', STEPS)).toBe('{{steps.missing.output}}')
  })

  it('leaves non-template text unchanged', () => {
    expect(resolveTemplateExpr('no template here', STEPS)).toBe('no template here')
  })

  it('replaces only the template portion in a mixed string', () => {
    expect(resolveTemplateExpr('prefix {{steps.n1.output}} suffix', STEPS)).toBe(
      'prefix hello suffix'
    )
  })

  it('returns literal unchanged for malformed path (too short)', () => {
    expect(resolveTemplateExpr('{{steps.n1}}', STEPS)).toBe('{{steps.n1}}')
  })

  it('returns literal unchanged when json sub-path is missing', () => {
    expect(resolveTemplateExpr('{{steps.n1.json.nope.nope}}', STEPS)).toBe(
      '{{steps.n1.json.nope.nope}}'
    )
  })
})

describe('buildTemplateExpr', () => {
  it('builds output expression for empty path', () => {
    expect(buildTemplateExpr('n1', [])).toBe('{{steps.n1.output}}')
  })

  it('builds json expression for a simple property path', () => {
    expect(buildTemplateExpr('n1', ['field'])).toBe('{{steps.n1.json.field}}')
  })

  it('builds json expression for a nested path', () => {
    expect(buildTemplateExpr('n1', ['a', 'b'])).toBe('{{steps.n1.json.a.b}}')
  })

  it('builds json expression with array index', () => {
    expect(buildTemplateExpr('n1', ['arr', 0])).toBe('{{steps.n1.json.arr[0]}}')
  })
})

describe('resolveTemplatesDeep', () => {
  it('resolves strings nested in objects and arrays, leaving other values intact', () => {
    const input = {
      url: 'https://x/{{steps.n1.json.field}}',
      list: [{ name: 'k', value: '{{steps.n1.json.arr[1]}}' }],
      nested: { deep: { s: '{{steps.n1.output}}', n: 5, b: true, z: null } }
    }
    expect(resolveTemplatesDeep(input, STEPS)).toEqual({
      url: 'https://x/value',
      list: [{ name: 'k', value: 'y' }],
      nested: { deep: { s: 'hello', n: 5, b: true, z: null } }
    })
  })

  it('does not mutate the input and leaves non-step placeholders alone', () => {
    const input = { page: '{{$pageCount + 1}}', next: '{{$response.body.next}}' }
    const out = resolveTemplatesDeep(input, STEPS)
    expect(out).toEqual(input)
    expect(out).not.toBe(input)
  })
})
