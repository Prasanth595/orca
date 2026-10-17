import { randomUUID } from 'node:crypto'
import type { AgentWorkflow, WorkflowRun, WorkflowVariable } from '../../shared/workflow-types'
import type { Store } from '../persistence'
import { executeWorkflow } from './workflow-executor'
import { findDueWorkflows } from './workflow-scheduler'
import { buildSshRemoteExec } from './workflow-remote-exec'
import type { RemoteExecFn } from './workflow-remote-exec'
import type { SshConnectionManager } from '../ssh/ssh-connection-manager'
import type { WebContents } from 'electron'

const TICK_MS = 60 * 1000

export class WorkflowService {
  private timer: ReturnType<typeof setInterval> | null = null
  private webContents: WebContents | null = null
  private stopped = false
  private readonly activeAbortControllers = new Map<string, AbortController>()
  private resolveSshConnectionManager: () => SshConnectionManager | null = () => null

  constructor(private readonly store: Store) {}

  setWebContents(wc: WebContents): void {
    this.webContents = wc
  }

  /** Read at run time: SSH handlers may register after workflows, and the manager can be replaced. */
  setSshConnectionManagerResolver(resolve: () => SshConnectionManager | null): void {
    this.resolveSshConnectionManager = resolve
  }

  start(): void {
    if (this.stopped) {
      return
    }
    this.timer = setInterval(() => void this.tick(), TICK_MS)
  }

  stop(): void {
    this.stopped = true
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    for (const ac of this.activeAbortControllers.values()) {
      ac.abort()
    }
  }

  private async tick(): Promise<void> {
    if (this.stopped) {
      return
    }
    const now = Date.now()
    const workflows = this.store.listWorkflows()
    const due = findDueWorkflows(workflows, now)
    for (const wf of due) {
      if (this.store.getActiveWorkflowRun(wf.id)) {
        continue
      }
      await this.runWorkflow(wf, 'scheduled')
    }
  }

  private publish(event: string, payload: unknown): void {
    if (!this.webContents?.isDestroyed()) {
      this.webContents?.send(event, payload)
    }
  }

  /** `undefined` runs nodes on this machine, which only a local workflow may do. */
  private buildRemoteExec(workflow: AgentWorkflow): RemoteExecFn | undefined {
    if (workflow.executionTargetType !== 'ssh') {
      return undefined
    }
    const manager = this.resolveSshConnectionManager()
    if (!manager) {
      // Why fail instead of returning undefined: that would quietly run an SSH workflow locally.
      return async () => {
        throw new Error(
          `SSH is unavailable, so this SSH workflow cannot run on "${workflow.executionTargetId}".`
        )
      }
    }
    return buildSshRemoteExec(manager, workflow.executionTargetId)
  }

  async runWorkflow(
    workflow: AgentWorkflow,
    trigger: WorkflowRun['trigger']
  ): Promise<WorkflowRun> {
    const run = this.store.createWorkflowRunRecord(workflow, trigger)
    const ac = new AbortController()
    this.activeAbortControllers.set(run.id, ac)

    this.publish('workflows:runUpdated', { workflowId: workflow.id, run })

    const remoteExec = this.buildRemoteExec(workflow)

    void executeWorkflow(
      workflow,
      run.id,
      this.store.asOps(),
      {
        onNodeStart: (runId) => {
          const updated = this.store.listWorkflowRuns(workflow.id).find((r) => r.id === runId)
          if (updated) {
            this.publish('workflows:runUpdated', { workflowId: workflow.id, run: updated })
          }
        },
        onNodeComplete: (runId) => {
          const updated = this.store.listWorkflowRuns(workflow.id).find((r) => r.id === runId)
          if (updated) {
            this.publish('workflows:runUpdated', { workflowId: workflow.id, run: updated })
          }
        },
        onRunComplete: (runId) => {
          this.activeAbortControllers.delete(runId)
          const updated = this.store.listWorkflowRuns(workflow.id).find((r) => r.id === runId)
          if (updated) {
            this.publish('workflows:runUpdated', { workflowId: workflow.id, run: updated })
          }
          this.publish('workflows:changed', {
            workflows: this.store.listWorkflows(),
            runs: this.store.listWorkflowRuns()
          })
        }
      },
      ac.signal,
      remoteExec
    )

    return run
  }

  cancelRun(runId: string): void {
    this.activeAbortControllers.get(runId)?.abort()
    this.activeAbortControllers.delete(runId)
    this.store.finalizeWorkflowRunRecord(runId, 'cancelled')
    const run = this.store.listWorkflowRuns().find((r) => r.id === runId)
    if (run) {
      this.publish('workflows:runUpdated', { workflowId: run.workflowId, run })
    }
  }

  // ── CRUD ────────────────────────────────────────────────────────────

  createWorkflow(partial: Omit<AgentWorkflow, 'id' | 'createdAt' | 'updatedAt'>): AgentWorkflow {
    const now = Date.now()
    const workflow: AgentWorkflow = { ...partial, id: randomUUID(), createdAt: now, updatedAt: now }
    this.store.createWorkflowRecord(workflow)
    this.publish('workflows:changed', {
      workflows: this.store.listWorkflows(),
      runs: this.store.listWorkflowRuns()
    })
    return workflow
  }

  updateWorkflow(id: string, patch: Partial<AgentWorkflow>): AgentWorkflow | null {
    const updated = this.store.updateWorkflowRecord(id, patch)
    if (updated) {
      this.publish('workflows:changed', {
        workflows: this.store.listWorkflows(),
        runs: this.store.listWorkflowRuns()
      })
    }
    return updated
  }

  deleteWorkflow(id: string): boolean {
    const deleted = this.store.deleteWorkflowRecord(id)
    if (deleted) {
      this.publish('workflows:changed', {
        workflows: this.store.listWorkflows(),
        runs: this.store.listWorkflowRuns()
      })
    }
    return deleted
  }

  listWorkflows(): AgentWorkflow[] {
    return this.store.listWorkflows()
  }

  /** One source of truth for "run now": IPC and the CLI/RPC surface both go through this. */
  async runWorkflowNow(workflowId: string): Promise<WorkflowRun> {
    const workflow = this.getWorkflow(workflowId)
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found.`)
    }
    const run = await this.runWorkflow(workflow, 'manual')
    // First run activates scheduling if a cron trigger is present
    const hasCron = workflow.nodes.some((n) => n.type === 'trigger_cron')
    if (hasCron && !workflow.enabled) {
      this.activateSchedule(workflowId)
    }
    return run
  }

  listRuns(workflowId?: string): WorkflowRun[] {
    return this.store.listWorkflowRuns(workflowId)
  }

  getWorkflow(id: string): AgentWorkflow | null {
    return this.store.getWorkflowRecord(id)
  }

  activateSchedule(id: string): AgentWorkflow | null {
    return this.updateWorkflow(id, { enabled: true })
  }

  deactivateSchedule(id: string): AgentWorkflow | null {
    return this.updateWorkflow(id, { enabled: false })
  }

  // ── Variables ────────────────────────────────────────────────────────────

  listVariables(): WorkflowVariable[] {
    return this.store.listVariables()
  }

  setVariable(variable: WorkflowVariable): WorkflowVariable {
    return this.store.setVariable(variable)
  }

  deleteVariable(key: string): boolean {
    return this.store.deleteVariable(key)
  }
}
