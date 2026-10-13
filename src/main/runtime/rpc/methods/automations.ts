import { AUTOMATION_OWNER_FENCING_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import type { AutomationOwnerPrecondition } from '../../../../shared/automation-owner-precondition'
import { defineMethod, type RpcContext } from '../core'
import {
  AutomationCreate,
  AutomationId,
  AutomationList,
  AutomationRunId,
  AutomationRuns,
  AutomationSemanticEvaluation,
  AutomationWorkflowReceipt,
  AutomationUpdate
} from '../../../../shared/rpc-contract/automation-params'

function mutationOwner(
  id: string,
  expectedOwner: AutomationOwnerPrecondition | undefined,
  context: RpcContext
): AutomationOwnerPrecondition | undefined {
  if (
    expectedOwner ||
    context.clientCapabilities === undefined ||
    context.clientCapabilities.includes(AUTOMATION_OWNER_FENCING_RUNTIME_CAPABILITY)
  ) {
    return expectedOwner
  }
  // Legacy clients cannot echo owner metadata, so snapshot it at the RPC boundary.
  return context.runtime.automationOwnerPrecondition(id) ?? undefined
}

export const AUTOMATION_METHODS = [
  defineMethod({
    name: 'automation.list',
    permission: 'workspace',
    params: AutomationList,
    // The projection retains `automations`, so old clients ignore the added owner metadata.
    handler: (params, { runtime }) => runtime.listAutomationsForScope(params)
  }),
  defineMethod({
    name: 'automation.show',
    permission: 'workspace',
    params: AutomationId,
    // Why: the owner rides along so a client that cannot project one itself — the
    // CLI — can echo it back on the mutation that follows. Optional: an older
    // host omits it, and an older client ignores it.
    handler: (params, { runtime }) => {
      const automation = runtime.showAutomation(params.id, params.expectedOwner)
      const owner = runtime.automationOwnerPrecondition(params.id)
      return owner ? { automation, owner } : { automation }
    }
  }),
  defineMethod({
    name: 'automation.create',
    permission: 'workspace',
    params: AutomationCreate,
    handler: async (params, { runtime }) => ({
      automation: await runtime.createAutomation(params)
    })
  }),
  defineMethod({
    name: 'automation.update',
    permission: 'workspace',
    params: AutomationUpdate,
    handler: async (params, context) => ({
      automation: await context.runtime.updateAutomation(params.id, params.updates, {
        expectedOwner: mutationOwner(params.id, params.expectedOwner, context),
        destination: params.destination
      })
    })
  }),
  defineMethod({
    name: 'automation.delete',
    permission: 'workspace',
    params: AutomationId,
    handler: (params, context) =>
      context.runtime.deleteAutomation(
        params.id,
        mutationOwner(params.id, params.expectedOwner, context)
      )
  }),
  defineMethod({
    name: 'automation.runNow',
    permission: 'workspace',
    params: AutomationId,
    handler: async (params, context) => ({
      run: await context.runtime.runAutomationNow(
        params.id,
        mutationOwner(params.id, params.expectedOwner, context)
      )
    })
  }),
  defineMethod({
    name: 'automation.runShow',
    permission: 'workspace',
    params: AutomationRunId,
    handler: (params, { runtime }) => ({ run: runtime.showAutomationRun(params.id) })
  }),
  defineMethod({
    name: 'automation.recordWorkflowReceipt',
    permission: 'workspace',
    params: AutomationWorkflowReceipt,
    handler: async (params, { runtime }) => ({
      run: await runtime.recordAutomationWorkflowReceipt(
        params.runId,
        params.outcome,
        params.summary
      )
    })
  }),
  defineMethod({
    name: 'automation.recordSemanticEvaluation',
    permission: 'workspace',
    params: AutomationSemanticEvaluation,
    handler: async (params, { runtime }) => ({
      run: await runtime.recordAutomationSemanticEvaluation(params.runId, params.result)
    })
  }),
  defineMethod({
    name: 'automation.runs',
    permission: 'workspace',
    params: AutomationRuns,
    handler: (params, { runtime }) => {
      if (
        params.limit !== undefined ||
        params.cursor !== undefined ||
        params.status !== undefined ||
        params.since !== undefined
      ) {
        return runtime.listAutomationRunsPage(
          params.automationId,
          params.expectedOwner,
          params.limit,
          params.cursor,
          params.status,
          params.since
        )
      }
      return { runs: runtime.listAutomationRuns(params.automationId, params.expectedOwner) }
    }
  })
]
