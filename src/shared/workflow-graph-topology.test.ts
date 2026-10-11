import { describe, it, expect } from 'vitest'
import { topologicalSort, findTriggerNodes } from './workflow-graph-topology'
import type { AgentWorkflow, WorkflowNode } from './workflow-types'

function makeWf(nodes: WorkflowNode[], edges: AgentWorkflow['edges'] = []): AgentWorkflow {
  return {
    id: 'w',
    name: 'Test',
    description: '',
    schedule: null,
    enabled: true,
    executionTargetType: 'local',
    executionTargetId: 'local',
    nodes,
    edges,
    createdAt: 0,
    updatedAt: 0
  }
}

function node(id: string, pos: { x: number; y: number } = { x: 0, y: 0 }): WorkflowNode {
  return { id, type: 'trigger_manual', pos, data: {} }
}

function shell(id: string, pos: { x: number; y: number } = { x: 0, y: 0 }): WorkflowNode {
  return {
    id,
    type: 'shell_command',
    pos,
    data: { command: 'echo', workingDirectory: '/', timeoutSeconds: 5 }
  }
}

function edge(id: string, src: string, tgt: string): AgentWorkflow['edges'][number] {
  return { id, sourceNodeId: src, targetNodeId: tgt }
}

describe('topologicalSort', () => {
  it('returns empty array for empty workflow', () => {
    expect(topologicalSort(makeWf([]))).toEqual([])
  })

  it('returns single node for workflow with no edges', () => {
    const n = node('a')
    expect(topologicalSort(makeWf([n]))).toEqual([n])
  })

  it('returns linear chain in order A→B→C', () => {
    const [a, b, c] = [node('a'), shell('b'), shell('c')]
    const result = topologicalSort(makeWf([a, b, c], [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')]))
    expect(result?.map((n) => n.id)).toEqual(['a', 'b', 'c'])
  })

  it('returns valid order for diamond topology (A→B, A→C, B→D, C→D)', () => {
    const [a, b, c, d] = [node('a'), shell('b'), shell('c'), shell('d')]
    const result = topologicalSort(
      makeWf(
        [a, b, c, d],
        [edge('e1', 'a', 'b'), edge('e2', 'a', 'c'), edge('e3', 'b', 'd'), edge('e4', 'c', 'd')]
      )
    )
    expect(result).not.toBeNull()
    expect(result!.map((n) => n.id)[0]).toBe('a')
    expect(result!.map((n) => n.id).at(-1)).toBe('d')
  })

  it('returns null for cycle A→B, B→A', () => {
    const [a, b] = [node('a'), shell('b')]
    expect(topologicalSort(makeWf([a, b], [edge('e1', 'a', 'b'), edge('e2', 'b', 'a')]))).toBeNull()
  })

  it('returns null when edge references non-existent node', () => {
    const a = node('a')
    expect(topologicalSort(makeWf([a], [edge('e1', 'a', 'ghost')]))).toBeNull()
  })

  it('includes disconnected nodes', () => {
    const [a, b] = [node('a'), node('b')]
    const result = topologicalSort(makeWf([a, b]))
    expect(result).not.toBeNull()
    expect(result!.length).toBe(2)
  })

  it('orders parallel roots by y position (top-to-bottom)', () => {
    // Three unconnected triggers at different y positions — should come out top first
    const [top, mid, bottom] = [
      node('top', { x: 0, y: 100 }),
      node('mid', { x: 0, y: 300 }),
      node('bottom', { x: 0, y: 200 })
    ]
    const result = topologicalSort(makeWf([top, mid, bottom]))
    expect(result?.map((n) => n.id)).toEqual(['top', 'bottom', 'mid'])
  })

  it('orders parallel siblings unlocked by same predecessor by y position', () => {
    // trigger → [branch_top (y=100), branch_bottom (y=300)] → join
    const trigger = node('t', { x: 0, y: 0 })
    const branchTop = shell('bt', { x: 200, y: 100 })
    const branchBottom = shell('bb', { x: 200, y: 300 })
    const join = shell('j', { x: 400, y: 200 })
    const result = topologicalSort(
      makeWf(
        [trigger, branchTop, branchBottom, join],
        [edge('e1', 't', 'bt'), edge('e2', 't', 'bb'), edge('e3', 'bt', 'j'), edge('e4', 'bb', 'j')]
      )
    )
    expect(result?.map((n) => n.id)).toEqual(['t', 'bt', 'bb', 'j'])
  })

  it('uses x position as tiebreaker when y values are equal', () => {
    const left = shell('l', { x: 100, y: 200 })
    const right = shell('r', { x: 300, y: 200 })
    const result = topologicalSort(makeWf([right, left]))
    expect(result?.map((n) => n.id)).toEqual(['l', 'r'])
  })
})

describe('findTriggerNodes', () => {
  it('returns trigger nodes with no incoming edges', () => {
    const [a, b] = [node('a'), shell('b')]
    const result = findTriggerNodes(makeWf([a, b], [edge('e1', 'a', 'b')]))
    expect(result.map((n) => n.id)).toEqual(['a'])
  })

  it('excludes trigger node that has an incoming edge', () => {
    const [a, b] = [node('a'), node('b')]
    // b is a trigger type but has an incoming edge — shouldn't be returned
    const result = findTriggerNodes(makeWf([a, b], [edge('e1', 'a', 'b')]))
    expect(result.map((n) => n.id)).toEqual(['a'])
  })

  it('excludes non-trigger nodes', () => {
    const [a, b] = [node('a'), shell('b')]
    const result = findTriggerNodes(makeWf([a, b]))
    expect(result.map((n) => n.id)).toEqual(['a'])
  })

  it('returns empty when workflow has no nodes', () => {
    expect(findTriggerNodes(makeWf([]))).toEqual([])
  })
})
