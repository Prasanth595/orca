import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import { executeWorkflow } from './workflow-executor'
import { createWorkflowRun } from './workflow-run-store'
import { defaultHttpRequestData } from '../../shared/workflow-http-request-defaults'
import type { AgentWorkflow, WorkflowNode } from '../../shared/workflow-types'
import type { WorkflowStoreOperations } from './workflow-run-store'
import type { PersistedState } from '../../shared/persisted-state-types'

function portOf(server: http.Server): number {
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('Server is not listening on a TCP port')
  }
  return address.port
}

let server: http.Server
let base = ''

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      if (req.url?.startsWith('/fail')) {
        res.writeHead(500, { 'content-type': 'text/plain' })
        res.end('boom')
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          url: req.url,
          apiKey: req.headers['x-api-key'],
          received: JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')
        })
      )
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${portOf(server)}`
})

afterAll(() => {
  server.close()
})

function makeRun(
  nodes: WorkflowNode[],
  edges: AgentWorkflow['edges']
): {
  workflow: AgentWorkflow
  ops: WorkflowStoreOperations
  runId: string
} {
  const workflow: AgentWorkflow = {
    id: 'w1',
    name: 'HTTP',
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
  const state: Partial<PersistedState> = { agentWorkflows: [workflow], agentWorkflowRuns: [] }
  const ops: WorkflowStoreOperations = {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test stub
    state: state as PersistedState,
    flush: vi.fn()
  }
  return { workflow, ops, runId: createWorkflowRun(ops, workflow, 'manual').id }
}

const form: WorkflowNode = {
  id: 'form',
  type: 'form_input',
  pos: { x: 0, y: 0 },
  data: {
    fields: [
      { id: 'f1', label: 'userId', type: 'number', value: '7' },
      { id: 'f2', label: 'key', type: 'string', value: 'k-123' }
    ]
  }
}

describe('executeWorkflow — http_request', () => {
  it('resolves upstream templates and exposes the response to downstream nodes', async () => {
    const d = defaultHttpRequestData()
    const { workflow, ops, runId } = makeRun(
      [
        form,
        {
          id: 'http',
          type: 'http_request',
          pos: { x: 200, y: 0 },
          data: {
            ...d,
            method: 'POST',
            url: `${base}/users/{{steps.form.json.userId}}`,
            auth: {
              ...d.auth,
              type: 'header',
              name: 'X-Api-Key',
              value: '{{steps.form.json.key}}'
            },
            sendBody: true,
            bodyParameters: [{ name: 'id', value: '{{steps.form.json.userId}}', kind: 'text' }]
          }
        },
        {
          id: 'pick',
          type: 'json_transform',
          pos: { x: 400, y: 0 },
          data: { expression: '$.apiKey' }
        }
      ],
      [
        { id: 'e1', sourceNodeId: 'form', targetNodeId: 'http' },
        { id: 'e2', sourceNodeId: 'http', targetNodeId: 'pick' }
      ]
    )
    await executeWorkflow(workflow, runId, ops)

    const run = ops.state.agentWorkflowRuns.find((r) => r.id === runId)!
    expect(run.status).toBe('completed')
    const httpRun = run.nodeRuns.find((n) => n.nodeId === 'http')!
    expect(httpRun.outputValue).toEqual({
      url: '/users/7',
      apiKey: 'k-123',
      received: { id: '7' }
    })
    expect(run.nodeRuns.find((n) => n.nodeId === 'pick')!.outputValue).toBe('k-123')
  })

  it('fails the run on an error status and retries first', async () => {
    const { workflow, ops, runId } = makeRun(
      [
        {
          id: 'http',
          type: 'http_request',
          pos: { x: 0, y: 0 },
          data: { ...defaultHttpRequestData(), url: `${base}/fail` },
          retryCount: 1,
          retryDelaySeconds: 0.01
        }
      ],
      []
    )
    await executeWorkflow(workflow, runId, ops)
    const run = ops.state.agentWorkflowRuns.find((r) => r.id === runId)!
    expect(run.status).toBe('failed')
    const nodeRun = run.nodeRuns.find((n) => n.nodeId === 'http')!
    expect(nodeRun.error).toMatch(/status code 500 \(Internal Server Error\): boom/)
    expect(nodeRun.retryAttempt).toBe(1)
  })
})
