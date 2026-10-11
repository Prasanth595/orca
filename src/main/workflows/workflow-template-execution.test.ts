import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockShellRun, mockPythonRun, mockFileRead, mockFileWrite } = vi.hoisted(() => ({
  mockShellRun: vi.fn(),
  mockPythonRun: vi.fn(),
  mockFileRead: vi.fn(),
  mockFileWrite: vi.fn().mockResolvedValue({ bytesWritten: 0 })
}))
vi.mock('./workflow-node-runner-shell', () => ({ runShellCommandNode: mockShellRun }))
vi.mock('./workflow-node-runner-python', () => ({ runPythonScriptNode: mockPythonRun }))
vi.mock('./workflow-node-runner-file', () => ({
  runFileReadNode: mockFileRead,
  runFileWriteNode: mockFileWrite
}))

import { executeWorkflow } from './workflow-executor'
import { createWorkflowRun } from './workflow-run-store'
import { materializeTemplate, WORKFLOW_TEMPLATES } from '../../shared/workflow-templates'
import type { AgentWorkflow } from '../../shared/workflow-types'
import type { WorkflowStoreOperations } from './workflow-run-store'
import type { PersistedState } from '../../shared/persisted-state-types'

let seq = 0
const testIdGen = (): string => `id${(seq += 1)}`

function makeOps(workflow: AgentWorkflow): { ops: WorkflowStoreOperations; runId: string } {
  const state: Partial<PersistedState> = { agentWorkflows: [workflow], agentWorkflowRuns: [] }
  const ops: WorkflowStoreOperations = {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test stub
    state: state as PersistedState,
    flush: vi.fn()
  }
  const run = createWorkflowRun(ops, workflow, 'manual')
  return { ops, runId: run.id }
}

function templateWorkflow(templateId: string): AgentWorkflow {
  const template = WORKFLOW_TEMPLATES.find((t) => t.id === templateId)!
  const { nodes, edges } = materializeTemplate(template, testIdGen)
  return {
    id: 'wf1',
    name: template.name,
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

beforeEach(() => {
  seq = 0
  vi.clearAllMocks()
  mockFileWrite.mockResolvedValue({ bytesWritten: 0 })
})

// ─── materializeTemplate ─────────────────────────────────────────────────────

describe('materializeTemplate', () => {
  it('leaves no tpl_* IDs in nodes or edges', () => {
    for (const template of WORKFLOW_TEMPLATES) {
      seq = 0
      const { nodes, edges } = materializeTemplate(template, testIdGen)
      const serialized = JSON.stringify({ nodes, edges })
      expect(serialized).not.toContain('tpl_')
    }
  })

  it('remaps {{steps.tpl_nN.output}} references in data strings', () => {
    const csvTemplate = WORKFLOW_TEMPLATES.find((t) => t.id === 'csv-to-json')!
    seq = 0
    const { nodes } = materializeTemplate(csvTemplate, testIdGen)
    const fileWrite = nodes.find(
      (n) => n.type === 'file_write' && n.data.filePath === '/tmp/orca-input.csv'
    )!
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: file_write data shape is known
    const content = (fileWrite.data as { content: string }).content
    expect(content).not.toContain('tpl_')
    expect(content).toMatch(/\{\{steps\.id\d+\.output\}\}/)
  })

  it.each([
    { id: 'hello-world', nodes: 3, edges: 2, namedEdges: 0 },
    { id: 'system-snapshot', nodes: 4, edges: 3, namedEdges: 0 },
    { id: 'number-squarer', nodes: 6, edges: 5, namedEdges: 2 },
    { id: 'random-branch', nodes: 5, edges: 4, namedEdges: 2 },
    { id: 'csv-to-json', nodes: 6, edges: 5, namedEdges: 0 }
  ])(
    '$id has $nodes nodes, $edges edges, $namedEdges named edges',
    ({ id, nodes, edges, namedEdges }) => {
      const template = WORKFLOW_TEMPLATES.find((t) => t.id === id)!
      seq = 0
      const result = materializeTemplate(template, testIdGen)
      expect(result.nodes).toHaveLength(nodes)
      expect(result.edges).toHaveLength(edges)
      expect(result.edges.filter((e) => e.outputSelector !== undefined)).toHaveLength(namedEdges)
    }
  )
})

// ─── Template execution ───────────────────────────────────────────────────────

describe('Hello World template', () => {
  it('runs trigger → shell → file_write and all nodes complete', async () => {
    mockShellRun.mockResolvedValue({ stdout: 'Hello from Orca!\n', stderr: '', exitCode: 0 })
    const workflow = templateWorkflow('hello-world')
    const { ops, runId } = makeOps(workflow)
    const onNodeComplete = vi.fn()
    await executeWorkflow(workflow, runId, ops, { onNodeComplete })
    expect(onNodeComplete).toHaveBeenCalledTimes(3)
    expect(mockShellRun).toHaveBeenCalledTimes(1)
    expect(mockFileWrite).toHaveBeenCalledTimes(1)
    expect(mockFileWrite).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: '/tmp/orca-hello.txt' }),
      'Hello from Orca!\n',
      undefined
    )
  })
})

describe('System Snapshot template', () => {
  it('runs trigger → shell → python → file_write and all nodes complete', async () => {
    mockShellRun.mockResolvedValue({ stdout: 'myhost\n', stderr: '', exitCode: 0 })
    const snapshot = '{"hostname":"myhost","timestamp":"2024-01-01T00:00:00Z","platform":"Linux"}\n'
    mockPythonRun.mockResolvedValue({ stdout: snapshot, stderr: '', exitCode: 0 })
    const workflow = templateWorkflow('system-snapshot')
    const { ops, runId } = makeOps(workflow)
    const onNodeComplete = vi.fn()
    await executeWorkflow(workflow, runId, ops, { onNodeComplete })
    expect(onNodeComplete).toHaveBeenCalledTimes(4)
    expect(mockShellRun).toHaveBeenCalledTimes(1)
    expect(mockPythonRun).toHaveBeenCalledTimes(1)
    // Python receives hostname via stdin
    expect(mockPythonRun.mock.calls[0][1]).toBe('myhost\n')
    expect(mockFileWrite).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: '/tmp/orca-snapshot.json' }),
      snapshot,
      undefined
    )
  })
})

describe('Number Squarer template', () => {
  it('for_each iterates 5 items and file_write receives the collected results', async () => {
    mockPythonRun
      // First call: generate list
      .mockResolvedValueOnce({ stdout: '[1,2,3,4,5]\n', stderr: '', exitCode: 0 })
      // Next 5 calls: body squares
      .mockResolvedValue({ stdout: '{"n":1,"squared":1}\n', stderr: '', exitCode: 0 })
    const workflow = templateWorkflow('number-squarer')
    const { ops, runId } = makeOps(workflow)
    const onNodeComplete = vi.fn()
    await executeWorkflow(workflow, runId, ops, { onNodeComplete })
    // trigger + python_gen + for_each + collect + file_write = 5
    expect(onNodeComplete).toHaveBeenCalledTimes(5)
    // python called once for list gen + 5 times for body = 6
    expect(mockPythonRun).toHaveBeenCalledTimes(6)
    expect(mockFileWrite).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: '/tmp/orca-squared.json' }),
      expect.any(String),
      undefined
    )
  })
})

describe('Random Branch template', () => {
  it('routes to high path when python returns a value > 50', async () => {
    mockPythonRun.mockResolvedValue({ stdout: '75\n', stderr: '', exitCode: 0 })
    const workflow = templateWorkflow('random-branch')
    const { ops, runId } = makeOps(workflow)
    const onNodeComplete = vi.fn()
    await executeWorkflow(workflow, runId, ops, { onNodeComplete })
    // trigger + python + branch + file_write(high) = 4
    expect(onNodeComplete).toHaveBeenCalledTimes(4)
    expect(mockFileWrite).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: '/tmp/orca-branch-high.txt' }),
      expect.stringContaining('75'),
      undefined
    )
    expect(mockFileWrite).not.toHaveBeenCalledWith(
      expect.objectContaining({ filePath: '/tmp/orca-branch-low.txt' }),
      expect.any(String),
      undefined
    )
  })

  it('routes to low path when python returns a value <= 50', async () => {
    mockPythonRun.mockResolvedValue({ stdout: '25\n', stderr: '', exitCode: 0 })
    const workflow = templateWorkflow('random-branch')
    const { ops, runId } = makeOps(workflow)
    await executeWorkflow(workflow, runId, ops, {})
    expect(mockFileWrite).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: '/tmp/orca-branch-low.txt' }),
      expect.stringContaining('25'),
      undefined
    )
    expect(mockFileWrite).not.toHaveBeenCalledWith(
      expect.objectContaining({ filePath: '/tmp/orca-branch-high.txt' }),
      expect.any(String),
      undefined
    )
  })
})

describe('CSV to JSON template', () => {
  it('runs full 6-node chain, reading back the written CSV file', async () => {
    const csvData = 'name,score,grade\nAlice,95,A\n'
    mockPythonRun
      .mockResolvedValueOnce({ stdout: csvData, stderr: '', exitCode: 0 })
      .mockResolvedValue({
        stdout: '[{"name":"Alice","score":"95","grade":"A"}]\n',
        stderr: '',
        exitCode: 0
      })
    mockFileRead.mockResolvedValue({ content: csvData })
    const workflow = templateWorkflow('csv-to-json')
    const { ops, runId } = makeOps(workflow)
    const onNodeComplete = vi.fn()
    await executeWorkflow(workflow, runId, ops, { onNodeComplete })
    expect(onNodeComplete).toHaveBeenCalledTimes(6)
    expect(mockPythonRun).toHaveBeenCalledTimes(2)
    // Second python receives the CSV via stdin
    expect(mockPythonRun.mock.calls[1][1]).toBe(csvData)
    expect(mockFileWrite).toHaveBeenCalledTimes(2)
    expect(mockFileWrite).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: '/tmp/orca-output.json' }),
      expect.any(String),
      undefined
    )
  })
})
