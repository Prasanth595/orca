import type { AutomationService } from '../automations/service'
import type {
  Automation,
  AutomationCreateInput,
  AutomationRun,
  AutomationSemanticEvaluationResult,
  AutomationWorkflowOutcome,
  AutomationUpdateInput,
  AutomationWorkspaceMode
} from '../../shared/automations-types'
import type { RuntimeStore } from './runtime-store-contract'
import type { AutomationListParams, AutomationListResult } from '../../shared/automation-list-scope'
import type {
  AutomationOwnerFenceOperation,
  AutomationOwnerPrecondition,
  AutomationDestination
} from '../../shared/automation-owner-precondition'
import { runAutomationNowFenced } from '../automations/refused-manual-run'
import { paginateAutomationRuns } from '../../shared/automation-run-cursor'
import { hasRuntimeAutomationUpdateValue } from './runtime-automation-update-value'
import { assertAutomationRunContextMatchesTarget } from './runtime-automation-run-context'
import {
  resolveRuntimeAutomationTarget,
  type RuntimeAutomationTargetResolvers
} from './runtime-automation-target'

export type RuntimeAutomationCreateInput = Omit<
  AutomationCreateInput,
  'projectId' | 'workspaceId' | 'workspaceMode' | 'timezone'
> & {
  repo?: string
  workspace?: string
  workspaceMode?: AutomationWorkspaceMode
  timezone?: string
  destination?: AutomationDestination
}

export type RuntimeAutomationUpdateInput = Omit<
  AutomationUpdateInput,
  'projectId' | 'workspaceId'
> & {
  repo?: string
  workspace?: string
}

export class RuntimeAutomationController {
  private service: AutomationService | null = null

  constructor(
    private readonly store: RuntimeStore | null,
    private readonly resolvers: RuntimeAutomationTargetResolvers
  ) {}

  setService(service: AutomationService): void {
    this.service = service
  }

  /** Completed automation run terminals no client used, closed before an update; 0 off-headless. */
  releaseFinishedRunTerminals(): Promise<number> {
    return this.service?.releaseFinishedRunTerminals?.() ?? Promise.resolve(0)
  }

  /** Keep runtime-owned automation work ahead of queued external probes. */
  withExternalProbePriority<T>(run: () => T): T {
    const wrap = this.service?.externalProbePriority
    return wrap ? wrap(run) : run()
  }

  list(): Automation[] {
    if (!this.store?.listAutomations) {
      throw new Error('runtime_unavailable')
    }
    return this.store.listAutomations()
  }

  listRuns(automationId?: string): AutomationRun[] {
    if (!this.store?.listAutomationRuns) {
      throw new Error('runtime_unavailable')
    }
    return this.store.listAutomationRuns(automationId)
  }

  listRunsPage(
    automationId?: string,
    limit?: number,
    cursor?: string,
    status?: AutomationRun['status'],
    since?: number
  ) {
    if (this.store?.listAutomationRunsPage) {
      return this.store.listAutomationRunsPage(automationId, limit, cursor, status, since)
    }
    const runs = this.listRuns(automationId).filter(
      (run) => (!status || run.status === status) && (since === undefined || run.createdAt >= since)
    )
    return paginateAutomationRuns(runs, limit, cursor)
  }

  showRun(id: string): AutomationRun {
    const run = this.listRuns().find((entry) => entry.id === id)
    if (!run) {
      throw new Error('Automation run not found.')
    }
    return run
  }

  listForScope(params: AutomationListParams = {}): AutomationListResult {
    if (!this.store?.listAutomationsForScope) {
      throw new Error('runtime_unavailable')
    }
    return this.store.listAutomationsForScope(params)
  }

  ownerPrecondition(id: string): AutomationOwnerPrecondition | null {
    return this.store?.automationOwnerPrecondition?.(id) ?? null
  }

  show(id: string): Automation {
    const automation = this.list().find((entry) => entry.id === id)
    if (!automation) {
      throw new Error('Automation not found.')
    }
    return automation
  }

  async create(
    input: RuntimeAutomationCreateInput,
    destination?: AutomationDestination
  ): Promise<Automation> {
    if (!this.store?.createAutomation) {
      throw new Error('runtime_unavailable')
    }
    const target = await resolveRuntimeAutomationTarget(input, undefined, this.resolvers)
    assertAutomationRunContextMatchesTarget(input.runContext, target.repo)
    if (input.reuseSession && target.workspaceMode !== 'existing') {
      throw new Error('Session reuse requires an existing workspace target.')
    }
    const automation = this.store.createAutomation(
      {
        creationKey: input.creationKey,
        name: input.name,
        prompt: input.prompt,
        precheck: input.precheck,
        agentId: input.agentId,
        extraAgentArgs: input.extraAgentArgs,
        runContext: input.runContext,
        sourceContext: input.sourceContext,
        projectId: target.projectId,
        workspaceMode: target.workspaceMode,
        workspaceId: target.workspaceId,
        baseBranch: input.baseBranch,
        setupDecision: input.setupDecision,
        reuseSession: input.reuseSession,
        timezone: input.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
        rrule: input.rrule,
        dtstart: input.dtstart,
        enabled: input.enabled,
        missedRunGraceMinutes: input.missedRunGraceMinutes,
        workflowReceiptRequired: input.workflowReceiptRequired,
        semanticEvaluation: input.semanticEvaluation
      },
      (destination ?? input.destination)
        ? { destination: destination ?? input.destination }
        : undefined
    )
    await this.store.flushPendingOrThrowAsync?.({ drainToStableGeneration: false })
    return automation
  }

  async update(
    id: string,
    updates: RuntimeAutomationUpdateInput,
    options?: { expectedOwner?: AutomationOwnerPrecondition; destination?: AutomationDestination }
  ): Promise<Automation> {
    if (!this.store?.updateAutomation) {
      throw new Error('runtime_unavailable')
    }
    const current = this.show(id)
    const patch: AutomationUpdateInput = {}
    this.copyPatchValues(updates, patch)
    const targetChanged =
      hasRuntimeAutomationUpdateValue(updates, 'repo') ||
      hasRuntimeAutomationUpdateValue(updates, 'workspace') ||
      hasRuntimeAutomationUpdateValue(updates, 'workspaceMode')
    if (targetChanged) {
      const target = await resolveRuntimeAutomationTarget(updates, current, this.resolvers)
      assertAutomationRunContextMatchesTarget(updates.runContext, target.repo)
      if (patch.reuseSession === true && target.workspaceMode !== 'existing') {
        throw new Error('Session reuse requires an existing workspace target.')
      }
      patch.projectId = target.projectId
      patch.workspaceMode = target.workspaceMode
      patch.workspaceId = target.workspaceId
      if (target.workspaceMode !== 'existing') {
        patch.reuseSession = false
      }
    }
    if (
      !targetChanged &&
      hasRuntimeAutomationUpdateValue(updates, 'runContext') &&
      current.projectId
    ) {
      const repo = await this.resolvers.showRepo(`id:${current.projectId}`)
      assertAutomationRunContextMatchesTarget(updates.runContext, repo)
    }
    if (!targetChanged && patch.reuseSession && current.workspaceMode !== 'existing') {
      throw new Error('Session reuse requires an existing workspace target.')
    }
    const automation = this.store.updateAutomation(id, patch, options)
    await this.store.flushPendingOrThrowAsync?.({ drainToStableGeneration: false })
    return automation
  }

  async delete(
    id: string,
    expectedOwner?: AutomationOwnerPrecondition
  ): Promise<{ removed: boolean; id: string }> {
    if (!this.store?.deleteAutomation) {
      throw new Error('runtime_unavailable')
    }
    this.show(id)
    this.store.deleteAutomation(id, expectedOwner ? { expectedOwner } : undefined)
    await this.store.flushPendingOrThrowAsync?.({ drainToStableGeneration: false })
    return { removed: true, id }
  }

  async runNow(id: string, expectedOwner?: AutomationOwnerPrecondition): Promise<AutomationRun> {
    if (!this.service) {
      throw new Error('runtime_unavailable')
    }
    return await runAutomationNowFenced({
      automationId: id,
      service: this.service,
      fence: () => this.assertOwner(id, expectedOwner, 'execute')
    })
  }

  async recordWorkflowReceipt(
    runId: string,
    outcome: AutomationWorkflowOutcome,
    summary?: string
  ): Promise<AutomationRun> {
    if (!this.store?.recordAutomationWorkflowReceipt) {
      throw new Error('runtime_unavailable')
    }
    const run = this.showRun(runId)
    this.assertOwner(run.automationId, undefined, 'mutate')
    const updated = this.store.recordAutomationWorkflowReceipt(runId, outcome, summary)
    await this.store.flushPendingOrThrowAsync?.({ drainToStableGeneration: false })
    return updated
  }

  async recordSemanticEvaluation(
    runId: string,
    result: AutomationSemanticEvaluationResult
  ): Promise<AutomationRun> {
    if (!this.store?.recordAutomationSemanticEvaluation) {
      throw new Error('runtime_unavailable')
    }
    const run = this.showRun(runId)
    this.assertOwner(run.automationId, undefined, 'mutate')
    const updated = this.store.recordAutomationSemanticEvaluation(runId, result)
    await this.store.flushPendingOrThrowAsync?.({ drainToStableGeneration: false })
    return updated
  }

  assertOwner(
    id: string,
    expectedOwner: AutomationOwnerPrecondition | undefined,
    operation: AutomationOwnerFenceOperation
  ): void {
    if (!this.store?.assertAutomationOwnerFence) {
      if (expectedOwner) {
        throw new Error('runtime_unavailable')
      }
      return
    }
    this.store.assertAutomationOwnerFence({ id, expectedOwner, operation })
  }

  private copyPatchValues(
    updates: RuntimeAutomationUpdateInput,
    patch: AutomationUpdateInput
  ): void {
    const keys = [
      'name',
      'prompt',
      'precheck',
      'agentId',
      'extraAgentArgs',
      'runContext',
      'sourceContext',
      'baseBranch',
      'setupDecision',
      'reuseSession',
      'timezone',
      'rrule',
      'dtstart',
      'enabled',
      'missedRunGraceMinutes',
      'workflowReceiptRequired',
      'semanticEvaluation'
    ] as const
    for (const key of keys) {
      if (hasRuntimeAutomationUpdateValue(updates, key)) {
        Object.assign(patch, { [key]: updates[key] })
      }
    }
  }
}
