import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockShellRun, mockPythonRun, mockFileRead, mockFileWrite, mockHttpSend } = vi.hoisted(
  () => ({
    mockShellRun: vi.fn(),
    mockPythonRun: vi.fn(),
    mockFileRead: vi.fn(),
    mockFileWrite: vi.fn().mockResolvedValue({ bytesWritten: 0 }),
    mockHttpSend: vi.fn()
  })
)
vi.mock('./workflow-node-runner-shell', () => ({ runShellCommandNode: mockShellRun }))
vi.mock('./workflow-node-runner-python', () => ({ runPythonScriptNode: mockPythonRun }))
vi.mock('./workflow-node-runner-file', () => ({
  runFileReadNode: mockFileRead,
  runFileWriteNode: mockFileWrite
}))
// Only the network hop is faked; request building and response parsing run for real.
vi.mock('./workflow-http-transport', () => ({
  localHttpTransport: { send: mockHttpSend, readFile: vi.fn(), writeFile: vi.fn() }
}))

import { executeWorkflow } from './workflow-executor'
import { createWorkflowRun } from './workflow-run-store'
import { materializeTemplate, WORKFLOW_TEMPLATES } from '../../shared/workflow-templates'
import {
  HTTP_EXAMPLE_REPORT_PATH,
  TODO_SUMMARY_SCRIPT
} from '../../shared/workflow-template-http-api-report'
import { existsSync } from 'node:fs'
import { runProcess } from '@orca/process-host'
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
    { id: 'csv-to-json', nodes: 6, edges: 5, namedEdges: 0 },
    { id: 'http-api-report', nodes: 6, edges: 5, namedEdges: 0 }
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

describe('for_each with multi-node body chain', () => {
  it('executes every body node on each iteration, not once after for_each', async () => {
    mockPythonRun
      .mockResolvedValueOnce({ stdout: '[1,2,3]\n', stderr: '', exitCode: 0 }) // list gen
      .mockResolvedValue({ stdout: '{"squared":1}\n', stderr: '', exitCode: 0 }) // body python
    mockShellRun.mockResolvedValue({ stdout: 'processed\n', stderr: '', exitCode: 0 })
    mockFileWrite.mockResolvedValue({ bytesWritten: 0 })

    // trigger → python_gen → for_each →[body]→ python_body → shell_body
    //                                  →[done]→ collect → file_write
    const workflow: AgentWorkflow = {
      id: 'wf-multi',
      name: 'Multi-body test',
      description: '',
      schedule: null,
      enabled: true,
      executionTargetType: 'local',
      executionTargetId: 'local',
      createdAt: 0,
      updatedAt: 0,
      nodes: [
        { id: 'n1', type: 'trigger_manual', pos: { x: 0, y: 0 }, data: {} },
        {
          id: 'n2',
          type: 'python_script',
          pos: { x: 1, y: 0 },
          data: {
            script: 'print("[1,2,3]")',
            workingDirectory: '',
            timeoutSeconds: 10,
            pythonBin: 'python3'
          }
        },
        {
          id: 'n3',
          type: 'for_each',
          pos: { x: 2, y: 0 },
          data: { itemsExpression: '{{steps.n2.output}}', maxIterations: 20 }
        },
        {
          id: 'n4',
          type: 'python_script',
          pos: { x: 3, y: 0 },
          data: {
            script: 'import sys,json; n=json.loads(sys.stdin.read()); print(json.dumps(n*n))',
            workingDirectory: '',
            timeoutSeconds: 10,
            pythonBin: 'python3'
          }
        },
        {
          id: 'n5',
          type: 'shell_command',
          pos: { x: 4, y: 0 },
          data: { command: 'echo "done"', workingDirectory: '', timeoutSeconds: 10, shell: 'bash' }
        },
        { id: 'n6', type: 'collect', pos: { x: 5, y: 0 }, data: {} },
        {
          id: 'n7',
          type: 'file_write',
          pos: { x: 6, y: 0 },
          data: {
            filePath: '/tmp/orca-multi-body.json',
            content: '{{steps.n6.output}}',
            mode: 'overwrite',
            createParents: true
          }
        }
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2' },
        { id: 'e2', sourceNodeId: 'n2', targetNodeId: 'n3' },
        { id: 'e3', sourceNodeId: 'n3', targetNodeId: 'n4', outputSelector: 'body' },
        { id: 'e4', sourceNodeId: 'n4', targetNodeId: 'n5' }, // body chain: python → shell
        { id: 'e5', sourceNodeId: 'n3', targetNodeId: 'n6', outputSelector: 'done' },
        { id: 'e6', sourceNodeId: 'n6', targetNodeId: 'n7' }
      ]
    }

    const { ops, runId } = makeOps(workflow)
    const onNodeComplete = vi.fn()
    await executeWorkflow(workflow, runId, ops, { onNodeComplete })

    // shell must run once per iteration (3 times), not once after for_each
    expect(mockShellRun).toHaveBeenCalledTimes(3)
    // python: 1 (list gen) + 3 (body) = 4
    expect(mockPythonRun).toHaveBeenCalledTimes(4)
    // trigger + python_gen + for_each + collect + file_write = 5
    expect(onNodeComplete).toHaveBeenCalledTimes(5)
    expect(mockFileWrite).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: '/tmp/orca-multi-body.json' }),
      expect.any(String),
      undefined
    )
  })

  it('chains stdout from first to second body node on each iteration', async () => {
    mockPythonRun
      .mockResolvedValueOnce({ stdout: '["a","b"]\n', stderr: '', exitCode: 0 })
      .mockResolvedValue({ stdout: 'python-out\n', stderr: '', exitCode: 0 })
    mockShellRun.mockResolvedValue({ stdout: 'shell-out\n', stderr: '', exitCode: 0 })

    const workflow: AgentWorkflow = {
      id: 'wf-chain',
      name: 'Chain test',
      description: '',
      schedule: null,
      enabled: true,
      executionTargetType: 'local',
      executionTargetId: 'local',
      createdAt: 0,
      updatedAt: 0,
      nodes: [
        { id: 'n1', type: 'trigger_manual', pos: { x: 0, y: 0 }, data: {} },
        {
          id: 'n2',
          type: 'python_script',
          pos: { x: 1, y: 0 },
          data: { script: '', workingDirectory: '', timeoutSeconds: 10, pythonBin: 'python3' }
        },
        {
          id: 'n3',
          type: 'for_each',
          pos: { x: 2, y: 0 },
          data: { itemsExpression: '{{steps.n2.output}}', maxIterations: 20 }
        },
        {
          id: 'n4',
          type: 'python_script',
          pos: { x: 3, y: 0 },
          data: { script: '', workingDirectory: '', timeoutSeconds: 10, pythonBin: 'python3' }
        },
        {
          id: 'n5',
          type: 'shell_command',
          pos: { x: 4, y: 0 },
          data: { command: 'cat', workingDirectory: '', timeoutSeconds: 10, shell: 'bash' }
        },
        { id: 'n6', type: 'collect', pos: { x: 5, y: 0 }, data: {} }
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2' },
        { id: 'e2', sourceNodeId: 'n2', targetNodeId: 'n3' },
        { id: 'e3', sourceNodeId: 'n3', targetNodeId: 'n4', outputSelector: 'body' },
        { id: 'e4', sourceNodeId: 'n4', targetNodeId: 'n5' },
        { id: 'e5', sourceNodeId: 'n3', targetNodeId: 'n6', outputSelector: 'done' }
      ]
    }

    const { ops, runId } = makeOps(workflow)
    await executeWorkflow(workflow, runId, ops, {})

    // shell receives python's stdout as its stdin on each iteration
    expect(mockShellRun).toHaveBeenCalledTimes(2)
    for (const call of mockShellRun.mock.calls) {
      expect(call[1]).toBe('python-out\n')
    }
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

describe('HTTP API Report template', () => {
  const todos = [
    { id: 1, title: 'a', completed: true },
    { id: 2, title: 'b', completed: false },
    { id: 3, title: 'c', completed: true },
    { id: 4, title: 'd', completed: false }
  ]
  const summary = { total: 4, completed: 2, open: 2, completionRate: 50, nextUp: ['b', 'd'] }

  function jsonResponse(statusCode: number, body: unknown) {
    return {
      statusCode,
      statusMessage: statusCode === 201 ? 'Created' : 'OK',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: Buffer.from(JSON.stringify(body))
    }
  }

  it('chains shell → HTTP GET → python → HTTP POST → shell with templates resolved', async () => {
    mockShellRun
      .mockResolvedValueOnce({ stdout: 'my-host', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'Published report #101\n', stderr: '', exitCode: 0 })
    mockPythonRun.mockResolvedValue({ stdout: JSON.stringify(summary), stderr: '', exitCode: 0 })
    mockHttpSend
      .mockResolvedValueOnce(jsonResponse(200, todos))
      .mockImplementationOnce(async (req: { body: Buffer }) =>
        jsonResponse(201, { id: 101, ...JSON.parse(req.body.toString('utf8')) })
      )

    const workflow = templateWorkflow('http-api-report')
    const { ops, runId } = makeOps(workflow)
    await executeWorkflow(workflow, runId, ops, {})
    const run = ops.state.agentWorkflowRuns.find((r) => r.id === runId)!
    expect(run.status).toBe('completed')
    expect(run.nodeRuns.every((n) => n.status === 'completed')).toBe(true)

    // GET carries the query parameter.
    const [getReq] = mockHttpSend.mock.calls[0]!
    expect(getReq).toMatchObject({
      method: 'GET',
      url: 'https://jsonplaceholder.typicode.com/todos?userId=1',
      body: null
    })
    // Python receives the GET response body on stdin.
    expect(JSON.parse(mockPythonRun.mock.calls[0]![1])).toEqual(todos)

    // POST body and header are built from the shell and python outputs.
    const [postReq] = mockHttpSend.mock.calls[1]!
    expect(postReq.method).toBe('POST')
    expect(postReq.url).toBe('https://jsonplaceholder.typicode.com/posts')
    expect(postReq.headers).toMatchObject({
      'content-type': 'application/json',
      'x-report-host': 'my-host'
    })
    expect(JSON.parse(postReq.body.toString('utf8'))).toEqual({
      title: 'Todo report from my-host',
      body: '2 of 4 todos done (50%)',
      userId: 1
    })

    // The final shell command gets the POST response values.
    const finalCommand = mockShellRun.mock.calls[1]![0].command
    expect(finalCommand).toContain("'101' '2 of 4 todos done (50%)'")
    expect(finalCommand).toContain(HTTP_EXAMPLE_REPORT_PATH)
  })

  it('fails the run when the API returns an error status', async () => {
    mockShellRun.mockResolvedValue({ stdout: 'my-host', stderr: '', exitCode: 0 })
    mockHttpSend.mockResolvedValue(jsonResponse(503, { error: 'down' }))
    const workflow = templateWorkflow('http-api-report')
    const { ops, runId } = makeOps(workflow)
    await executeWorkflow(workflow, runId, ops, {})
    const run = ops.state.agentWorkflowRuns.find((r) => r.id === runId)!
    expect(run.status).toBe('failed')
    expect(run.error).toMatch(/status code 503/)
    expect(mockPythonRun).not.toHaveBeenCalled()
  })
})

const hasPython3 = process.platform !== 'win32' && existsSync('/usr/bin/python3')

describe.skipIf(!hasPython3)('HTTP API Report summary script', () => {
  it('summarizes todos with real python3', async () => {
    const r = await runProcess({
      program: '/usr/bin/python3',
      args: ['-c', TODO_SUMMARY_SCRIPT],
      input: JSON.stringify([
        { title: 'a', completed: true },
        { title: 'b', completed: false },
        { title: 'c', completed: false },
        { title: 'd', completed: false },
        { title: 'e', completed: false }
      ])
    })
    expect(r.code).toBe(0)
    expect(JSON.parse(r.stdout)).toEqual({
      total: 5,
      completed: 1,
      open: 4,
      completionRate: 20,
      nextUp: ['b', 'c', 'd']
    })
  })
})
