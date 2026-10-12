import { defineMethod } from '../../../core'
import { OrchestrationError } from '../../../../orchestration/orchestration-error'
import { assertCallerHandleMatchesEvidence, resolveOrchestrationCaller } from './run-scope'
import { exposeRun } from './run-receipt'
import type { OrcaRuntimeService } from '../../../../orca-runtime'
import type { OrchestrationCallerIdentity } from '../../../../orchestration/orchestration-caller-identity'
import type { OrchestrationNotificationPolicy } from '../../../../../../shared/orchestration-coordinator-delivery'
import { currentDispatchAssigneeRun } from '../messaging/recipient-routing'
import {
  RunCreateParams,
  RunCurrentParams,
  RunListParams,
  RunShowParams,
  RunUseParams
} from '../../../../../../shared/rpc-contract/orchestration-runs-params'

function cancelBoundDispatchWaiters(
  runtime: OrcaRuntimeService,
  caller: OrchestrationCallerIdentity,
  runId: string
): void {
  const db = runtime.getOrchestrationDb()
  const dispatch = db.getActiveDispatchForIdentity(caller.address, caller.paneKey ?? undefined)
  if (dispatch && currentDispatchAssigneeRun(runtime, db, dispatch)?.id === runId) {
    runtime.cancelMessageWaiters(`dispatch:${dispatch.id}`)
  }
}

function assertCoordinatorDeliveryOwnerSupported(
  runtime: OrcaRuntimeService,
  policy: OrchestrationNotificationPolicy | undefined,
  address: string
): void {
  if (policy === 'coordination' && !runtime.supportsCoordinatorDelivery(address)) {
    throw new OrchestrationError(
      'coordinator_delivery_unsupported',
      'Coordination delivery requires a supported Codex terminal owner. No effects were applied.',
      { effectsApplied: false }
    )
  }
}

export const ORCHESTRATION_RUN_METHODS = [
  defineMethod({
    name: 'orchestration.runCreate',
    permission: 'workspace',
    params: RunCreateParams,
    handler: (params, { orchestrationCompatibilityEvidence, orchestrationCaller, runtime }) => {
      const caller = resolveOrchestrationCaller(runtime, {
        callerTerminalHandle: params.from,
        callerEvidence: orchestrationCompatibilityEvidence,
        callerSession: orchestrationCaller,
        requireStablePane: true
      })
      const db = runtime.getOrchestrationDb()
      const priorRun = db.getCurrentRunForCoordinator(caller)
      assertCoordinatorDeliveryOwnerSupported(runtime, params.notificationPolicy, caller.address)
      const run = db.createRun({
        objective: params.objective,
        notificationPolicy: params.notificationPolicy,
        coordinatorHandle: caller.terminalHandle,
        coordinatorPaneKey: caller.paneKey,
        coordinatorOrcaSessionId: caller.orcaSessionId
      })
      runtime.cancelMessageWaiters(params.from)
      cancelBoundDispatchWaiters(runtime, caller, run.id)
      if (priorRun) {
        runtime.cancelMessageWaiters(`run:${priorRun.id}`)
      }
      return { run: exposeRun(run) }
    }
  }),
  defineMethod({
    name: 'orchestration.runUse',
    permission: 'workspace',
    params: RunUseParams,
    handler: (
      params,
      {
        runtime,
        legacyCoordinatorAuthority,
        orchestrationCompatibilityEvidence,
        orchestrationCompatibilityCallerAuthority: callerAuthority,
        orchestrationCaller
      }
    ) => {
      const caller = resolveOrchestrationCaller(runtime, {
        callerTerminalHandle: params.from,
        callerEvidence: orchestrationCompatibilityEvidence,
        callerAuthority,
        callerSession: orchestrationCaller,
        requireStablePane: true,
        evidenceAssertedByCaller: true
      })
      if (
        params.takeoverLegacy &&
        (callerAuthority?.terminalHandle !== params.from ||
          callerAuthority.paneKey !== caller.paneKey)
      ) {
        throw new OrchestrationError(
          'legacy_read_only',
          'Legacy takeover must be invoked by the live coordinator agent terminal it will bind. No effects were applied.',
          { effectsApplied: false }
        )
      }
      assertCallerHandleMatchesEvidence(runtime, params.from, orchestrationCompatibilityEvidence)
      const db = runtime.getOrchestrationDb()
      const priorRun = db.getCurrentRunForCoordinator(caller)
      assertCoordinatorDeliveryOwnerSupported(
        runtime,
        db.getRun(params.id)?.notification_policy,
        caller.address
      )
      const run = db.bindRun({
        runId: params.id,
        coordinatorHandle: caller.terminalHandle,
        coordinatorPaneKey: caller.paneKey,
        coordinatorOrcaSessionId: caller.orcaSessionId,
        takeoverLegacy: params.takeoverLegacy,
        legacyCoordinatorAuthority
      })
      if (!run) {
        throw new OrchestrationError(
          'run_not_found',
          `Run ${params.id} was not found or is inspect-only.`
        )
      }
      runtime.cancelMessageWaiters(params.from)
      cancelBoundDispatchWaiters(runtime, caller, run.id)
      runtime.cancelMessageWaiters(`run:${params.id}`)
      if (priorRun && priorRun.id !== params.id) {
        runtime.cancelMessageWaiters(`run:${priorRun.id}`)
      }
      return { run: exposeRun(run) }
    }
  }),
  defineMethod({
    name: 'orchestration.runCurrent',
    permission: 'workspace',
    params: RunCurrentParams,
    handler: (params, { orchestrationCompatibilityEvidence, orchestrationCaller, runtime }) => {
      const caller = resolveOrchestrationCaller(runtime, {
        callerTerminalHandle: params.from,
        callerEvidence: orchestrationCompatibilityEvidence,
        callerSession: orchestrationCaller,
        requireStablePane: true
      })
      const run = runtime.getOrchestrationDb().getCurrentRunForCoordinator(caller)
      return { run: run ? exposeRun(run) : null }
    }
  }),
  defineMethod({
    name: 'orchestration.runList',
    permission: 'workspace',
    params: RunListParams,
    handler: (params, { runtime }) => {
      const listed = runtime.getOrchestrationDb().listRuns(params)
      return { ...listed, runs: listed.runs.map(exposeRun) }
    }
  }),
  defineMethod({
    name: 'orchestration.runShow',
    permission: 'workspace',
    params: RunShowParams,
    handler: (params, { runtime }) => {
      const run = runtime.getOrchestrationDb().getRun(params.id)
      if (!run) {
        throw new OrchestrationError('run_not_found', `Run ${params.id} was not found.`)
      }
      const processIncarnation = run.coordinator_handle
        ? runtime.getTerminalProcessIncarnation(run.coordinator_handle)
        : null
      return {
        run: exposeRun(run),
        passOwner:
          run.notification_policy === 'coordination' && run.coordinator_handle && processIncarnation
            ? {
                handle: run.coordinator_handle,
                consumerGeneration: run.consumer_generation,
                processIncarnation
              }
            : null
      }
    }
  })
]
