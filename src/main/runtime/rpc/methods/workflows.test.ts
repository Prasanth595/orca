import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { WorkflowRun } from '../../../../shared/workflow-types'
import { eraseRpcMethods } from '../core'
import { WORKFLOW_METHODS } from './workflows'

const METHODS = eraseRpcMethods(WORKFLOW_METHODS)

function method(name: string) {
  const found = METHODS.find((candidate) => candidate.name === name)
  if (!found) {
    throw new Error(`Missing method ${name}`)
  }
  return found
}

type WorkflowRuntimeStub = {
  listWorkflows: ReturnType<typeof vi.fn>
  showWorkflow: ReturnType<typeof vi.fn>
  importWorkflow: ReturnType<typeof vi.fn>
  deleteWorkflow: ReturnType<typeof vi.fn>
  runWorkflowNow: ReturnType<typeof vi.fn>
  listWorkflowRuns: ReturnType<typeof vi.fn>
}

function zeroStubs(): WorkflowRuntimeStub {
  return {
    listWorkflows: vi.fn(() => []),
    showWorkflow: vi.fn(() => null),
    importWorkflow: vi.fn(async (parsed: unknown) => parsed),
    deleteWorkflow: vi.fn(() => true),
    runWorkflowNow: vi.fn(async () => null),
    listWorkflowRuns: vi.fn(() => [])
  }
}

function asContext(stub: WorkflowRuntimeStub) {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: harness stub; workflow handlers only read the members declared in WorkflowRuntimeStub.
  return { runtime: stub as unknown as OrcaRuntimeService } as never
}

function shellExport(name: string, executionTargetType: 'local' | 'ssh'): string {
  return JSON.stringify({
    version: 1,
    name,
    executionTargetType,
    nodes: [
      { id: 'shell-a', type: 'shell_command', pos: { x: 0, y: 0 }, data: { command: 'df -h' } }
    ],
    edges: []
  })
}

const RUN: WorkflowRun = {
  id: 'run-1',
  workflowId: 'wf-1',
  trigger: 'manual',
  status: 'running',
  startedAt: Date.now(),
  completedAt: null,
  error: null,
  nodeRuns: []
}

describe('workflow RPC methods', () => {
  it('list returns the store listing', async () => {
    const list = method('workflows.list')
    const listWorkflows = vi.fn(() => [{ id: 'wf-1' }])
    await list.handler(undefined, asContext({ ...zeroStubs(), listWorkflows }))

    expect(listWorkflows).toHaveBeenCalledOnce()
  })

  it('import parses a version-1 export, re-ids it, and imports locally by default', async () => {
    const importMethod = method('workflows.import')
    const importWorkflow = vi.fn(async (parsed: { nodes: { id: string }[] }) => parsed)
    await importMethod.handler(
      { json: shellExport('Disk space', 'local') },
      asContext({
        ...zeroStubs(),
        importWorkflow
      })
    )

    expect(importWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Disk space',
        executionTargetType: 'local',
        executionTargetId: 'local'
      })
    )
    const importArg = importWorkflow.mock.calls[0]?.[0]
    expect(importArg?.nodes[0]?.id).toBeTruthy()
  })

  it('ssh imports require an execution target', async () => {
    const importMethod = method('workflows.import')
    await expect(
      importMethod.handler({ json: shellExport('Remote', 'ssh') }, asContext(zeroStubs()))
    ).rejects.toThrow(/--execution-target/)
  })

  it('run and runs delegate to the runtime', async () => {
    const run = method('workflows.run')
    const runs = method('workflows.runs')
    const runWorkflowNow = vi.fn(async () => RUN)
    const listWorkflowRuns = vi.fn(() => [RUN])
    const stub: WorkflowRuntimeStub = { ...zeroStubs(), runWorkflowNow, listWorkflowRuns }

    await run.handler({ id: randomUUID() }, asContext(stub))
    expect(runWorkflowNow).toHaveBeenCalledOnce()

    await runs.handler({ workflowId: undefined, limit: 1 }, asContext(stub))
    expect(listWorkflowRuns).toHaveBeenCalledWith(undefined)
  })
})
