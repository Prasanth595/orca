import { describe, expect, it, vi } from 'vitest'
import type { AgentWorkflow, WorkflowRun } from '../../shared/workflow-types'
import { RuntimeWorkflowController } from './runtime-workflow-controller'
import type { WorkflowService } from '../workflows/workflow-service'

function asService(stub: Record<string, unknown>): WorkflowService {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: harness stub; the controller only calls the members the test stubs.
  return stub as unknown as WorkflowService
}

const WORKFLOW: AgentWorkflow = {
  id: 'wf-1',
  name: 'Disk space',
  description: '',
  schedule: null,
  enabled: false,
  executionTargetType: 'local',
  executionTargetId: 'local',
  nodes: [],
  edges: [],
  createdAt: 1,
  updatedAt: 1
}

const RUN: WorkflowRun = {
  id: 'run-1',
  workflowId: 'wf-1',
  trigger: 'manual',
  status: 'pending',
  startedAt: Date.now(),
  completedAt: null,
  error: null,
  nodeRuns: []
} as unknown as WorkflowRun

describe('RuntimeWorkflowController', () => {
  it('delegates every operation to the workflow service', async () => {
    const service = asService({
      listWorkflows: vi.fn(() => [WORKFLOW]),
      getWorkflow: vi.fn(() => WORKFLOW),
      createWorkflow: vi.fn(() => WORKFLOW),
      deleteWorkflow: vi.fn(() => true),
      runWorkflowNow: vi.fn(async () => RUN),
      listRuns: vi.fn(() => [RUN])
    })
    const controller = new RuntimeWorkflowController()
    controller.setService(service)

    expect(controller.list()).toEqual([WORKFLOW])
    expect(controller.show('wf-1')).toEqual(WORKFLOW)
    await expect(
      controller.importFile({
        name: 'Disk space',
        executionTargetType: 'local',
        executionTargetId: 'local',
        nodes: [],
        edges: []
      })
    ).resolves.toEqual(WORKFLOW)
    expect(controller.delete('wf-1')).toBe(true)
    await expect(controller.runNow('wf-1')).resolves.toEqual(RUN)
    expect(controller.runs('wf-1')).toEqual([RUN])
  })

  it('refuses operations before a service is attached', () => {
    const controller = new RuntimeWorkflowController()
    expect(() => controller.list()).toThrow(/unavailable/)
    expect(() => controller.show('wf-1')).toThrow(/unavailable/)
    expect(() => controller.runs('wf-1')).toThrow(/unavailable/)
  })
})
