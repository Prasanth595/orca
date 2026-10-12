import { describe, it, expect } from 'vitest'
import { runFormInputNode } from './workflow-node-runner-form'
import type { FormInputField } from '../../shared/workflow-types'

function field(overrides: Partial<FormInputField> & Pick<FormInputField, 'type'>): FormInputField {
  return { id: 'f1', label: 'key', value: '', ...overrides }
}

describe('runFormInputNode', () => {
  it('returns empty object for no fields', () => {
    expect(runFormInputNode({ fields: [] }).value).toEqual({})
  })

  it('string field returns the value as-is', () => {
    expect(
      runFormInputNode({ fields: [field({ type: 'string', label: 'name', value: 'Alice' })] }).value
    ).toEqual({ name: 'Alice' })
  })

  it('string field empty string', () => {
    expect(
      runFormInputNode({ fields: [field({ type: 'string', label: 'x', value: '' })] }).value
    ).toEqual({ x: '' })
  })

  it('number field parses to number', () => {
    expect(
      runFormInputNode({ fields: [field({ type: 'number', label: 'age', value: '42' })] }).value
    ).toEqual({ age: 42 })
  })

  it('number field float', () => {
    expect(
      runFormInputNode({ fields: [field({ type: 'number', label: 'n', value: '3.14' })] }).value
    ).toEqual({ n: 3.14 })
  })

  it('number field NaN falls back to null', () => {
    expect(
      runFormInputNode({ fields: [field({ type: 'number', label: 'x', value: 'abc' })] }).value
    ).toEqual({ x: null })
  })

  it('number field empty string falls back to null', () => {
    expect(
      runFormInputNode({ fields: [field({ type: 'number', label: 'x', value: '' })] }).value
    ).toEqual({ x: null })
  })

  it('multi_choice field returns selected string', () => {
    expect(
      runFormInputNode({ fields: [field({ type: 'multi_choice', label: 'color', value: 'red' })] })
        .value
    ).toEqual({ color: 'red' })
  })

  it('json field parses valid JSON object', () => {
    expect(
      runFormInputNode({ fields: [field({ type: 'json', label: 'data', value: '{"k":1}' })] }).value
    ).toEqual({ data: { k: 1 } })
  })

  it('json field parses valid JSON array', () => {
    expect(
      runFormInputNode({ fields: [field({ type: 'json', label: 'list', value: '[1,2,3]' })] }).value
    ).toEqual({ list: [1, 2, 3] })
  })

  it('json field invalid JSON falls back to raw string', () => {
    expect(
      runFormInputNode({ fields: [field({ type: 'json', label: 'data', value: 'not-json' })] })
        .value
    ).toEqual({ data: 'not-json' })
  })

  it('multiple fields of different types', () => {
    const fields: FormInputField[] = [
      { id: '1', label: 'name', type: 'string', value: 'Bob' },
      { id: '2', label: 'age', type: 'number', value: '30' },
      { id: '3', label: 'tags', type: 'json', value: '["a","b"]' },
      { id: '4', label: 'choice', type: 'multi_choice', value: 'optA' }
    ]
    expect(runFormInputNode({ fields }).value).toEqual({
      name: 'Bob',
      age: 30,
      tags: ['a', 'b'],
      choice: 'optA'
    })
  })

  it('uses label as the output key', () => {
    expect(
      runFormInputNode({
        fields: [field({ id: 'some-uuid', label: 'myKey', type: 'string', value: 'v' })]
      }).value
    ).toEqual({ myKey: 'v' })
  })

  it('falls back to id when label is empty', () => {
    expect(
      runFormInputNode({ fields: [field({ id: 'myId', label: '', type: 'string', value: 'val' })] })
        .value
    ).toEqual({ myId: 'val' })
  })

  it('last field wins when two fields share the same label', () => {
    const fields: FormInputField[] = [
      { id: '1', label: 'dup', type: 'string', value: 'first' },
      { id: '2', label: 'dup', type: 'string', value: 'second' }
    ]
    expect(runFormInputNode({ fields }).value).toEqual({ dup: 'second' })
  })
})
