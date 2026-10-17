import { defineMethod } from '../core'
import { randomUUID } from 'node:crypto'
import { assignImportedWorkflowIds, parseWorkflowExport } from '../../../../shared/workflow-export'
import {
  WorkflowsDelete,
  WorkflowsImport,
  WorkflowsRun,
  WorkflowsRuns,
  WorkflowsShow
} from '../../../../shared/rpc-contract/workflow-params'

export const WORKFLOW_METHODS = [
  defineMethod({
    name: 'workflows.list',
    permission: 'workspace',
    params: null,
    handler: (_params, { runtime }) => ({ workflows: runtime.listWorkflows() })
  }),
  defineMethod({
    name: 'workflows.show',
    permission: 'workspace',
    params: WorkflowsShow,
    handler: (params, { runtime }) => ({ workflow: runtime.showWorkflow(params.id) })
  }),
  defineMethod({
    name: 'workflows.import',
    permission: 'workspace',
    params: WorkflowsImport,
    handler: async (params, { runtime }) => {
      const parsed = parseWorkflowExport(params.json)
      const executionTargetId =
        parsed.executionTargetType === 'ssh' ? params.executionTargetId?.trim() : 'local'
      if (parsed.executionTargetType === 'ssh' && !executionTargetId) {
        throw new Error(
          'This workflow targets SSH. Import again with --execution-target <server id>.'
        )
      }
      // Fresh ids mirror the renderer's import so the same JSON can be imported twice.
      const withIds = assignImportedWorkflowIds(parsed, () => randomUUID())
      const workflow = await runtime.importWorkflow({
        ...withIds,
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the ssh branch above guards the empty default to "local".
        executionTargetId: executionTargetId ?? 'local'
      })
      return { workflow }
    }
  }),
  defineMethod({
    name: 'workflows.delete',
    permission: 'workspace',
    params: WorkflowsDelete,
    handler: (params, { runtime }) => ({ deleted: runtime.deleteWorkflow(params.id) })
  }),
  defineMethod({
    name: 'workflows.run',
    permission: 'workspace',
    params: WorkflowsRun,
    handler: async (params, { runtime }) => ({ run: await runtime.runWorkflowNow(params.id) })
  }),
  defineMethod({
    name: 'workflows.runs',
    permission: 'workspace',
    params: WorkflowsRuns,
    handler: (params, { runtime }) => {
      const runs = runtime.listWorkflowRuns(params.workflowId)
      return { runs: params.limit === undefined ? runs : runs.slice(0, params.limit) }
    }
  })
]
