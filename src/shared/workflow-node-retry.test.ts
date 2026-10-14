import { describe, it, expect } from 'vitest'
import {
  applyNodeEdit,
  getNodeRetryConfig,
  nodeTypeSupportsRetry,
  parseRetryConfig
} from './workflow-node-retry'
import type { WorkflowNode } from './workflow-types'

const fileRead = (extra: Record<string, unknown> = {}, data: Record<string, unknown> = {}) =>
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test fixture deliberately carries legacy keys the type does not declare
  ({
    id: 'n',
    type: 'file_read',
    pos: { x: 0, y: 0 },
    data: { filePath: '/f', ...data },
    ...extra
  }) as WorkflowNode

describe('getNodeRetryConfig', () => {
  it('defaults to no retries and a 1s delay', () => {
    expect(getNodeRetryConfig(fileRead())).toEqual({ retryCount: 0, retryDelaySeconds: 1 })
  })

  it('reads node-level settings', () => {
    expect(getNodeRetryConfig(fileRead({ retryCount: 3, retryDelaySeconds: 0 }))).toEqual({
      retryCount: 3,
      retryDelaySeconds: 0
    })
  })

  it('falls back to settings older editors saved inside data', () => {
    expect(getNodeRetryConfig(fileRead({}, { retryCount: 2, retryDelaySeconds: 5 }))).toEqual({
      retryCount: 2,
      retryDelaySeconds: 5
    })
  })

  it('prefers node-level settings over legacy data', () => {
    const node = fileRead({ retryCount: 1 }, { retryCount: 4, retryDelaySeconds: 2 })
    expect(getNodeRetryConfig(node)).toEqual({ retryCount: 1, retryDelaySeconds: 2 })
  })
})

describe('parseRetryConfig', () => {
  it('parses form strings and rejects invalid values', () => {
    expect(parseRetryConfig({ retryCount: '2.7', retryDelaySeconds: '0.5' })).toEqual({
      retryCount: 2,
      retryDelaySeconds: 0.5
    })
    expect(parseRetryConfig({ retryCount: '-1', retryDelaySeconds: '' })).toEqual({
      retryCount: 0,
      retryDelaySeconds: 1
    })
  })
})

describe('applyNodeEdit', () => {
  it('stores retry on the node and strips legacy copies from data', () => {
    const node = fileRead({}, { retryCount: 0, retryDelaySeconds: 1 })
    expect(
      applyNodeEdit(
        node,
        { filePath: '/g', retryCount: 0 },
        { retryCount: '3', retryDelaySeconds: '2' }
      )
    ).toEqual({
      id: 'n',
      type: 'file_read',
      pos: { x: 0, y: 0 },
      data: { filePath: '/g' },
      retryCount: 3,
      retryDelaySeconds: 2
    })
  })

  it('does not add retry settings to nodes without retry support', () => {
    const trigger: WorkflowNode = { id: 't', type: 'trigger_manual', pos: { x: 0, y: 0 }, data: {} }
    expect(applyNodeEdit(trigger, {}, { retryCount: '3' })).toEqual(trigger)
    expect(nodeTypeSupportsRetry('trigger_manual')).toBe(false)
    expect(nodeTypeSupportsRetry('http_request')).toBe(true)
  })
})
