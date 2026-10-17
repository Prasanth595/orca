import { describe, expect, it } from 'vitest'
import type { AgentWorkflow, WorkflowRun } from '../../shared/workflow-types'
import { RuntimeWorkflowController } from './runtime-workflow-controller'

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
  status: 'running',
  startedAt: 1,
  completedAt: null,
  error: null,
  nodeRuns: []
}

/** Returns the recorded member names as a stub; the controller never calls more. */
function serviceRecording(calls: string[]) {
  return {
    listWorkflows: () => {
      calls.push('listWorkflows')
      return [WORKFLOW]
    },
    getWorkflow: (id: string) => {
      calls.push('getWorkflow')
      return id === 'wf-1' ? WORKFLOW : null
    },
    createWorkflow: () => {
      calls.push('createWorkflow')
      return WORKFLOW
    },
    deleteWorkflow: () => {
      calls.push('deleteWorkflow')
      return true
    },
    runWorkflowNow: (id: string) => {
      calls.push(`runWorkflowNow:${id}`)
      return Promise.resolve(RUN)
    },
    listRuns: (workflowId?: string) => {
      calls.push(`listRuns:${workflowId ?? 'all'}`)
      return [RUN]
    }
  }
}

describe('RuntimeWorkflowController', () => {
  it('delegates every operation to the workflow service', async () => {
    const calls: string[] = []
    const controller = new RuntimeWorkflowController()
    controller.setService(serviceRecording(calls))

    expect(controller.list()).toEqual([WORKFLOW])
    expect(controller.show('wf-1')).toEqual(WORKFLOW)
    expect(controller.show('missing')).toBeNull()
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

    // runNow passthrough shares the run-now semantics with the IPC surface.
    expect(calls).toEqual([
      'listWorkflows',
      'getWorkflow',
      'getWorkflow',
      'createWorkflow',
      'deleteWorkflow',
      'runWorkflowNow:wf-1',
      'listRuns:wf-1'
    ])
  })

  it('refuses operations before a service is attached', () => {
    const controller = new RuntimeWorkflowController()
    expect(() => controller.list()).toThrow(/unavailable/)
    expect(() => controller.show('wf-1')).toThrow(/unavailable/)
    expect(() => controller.runs('wf-1')).toThrow(/unavailable/)
  })
})
