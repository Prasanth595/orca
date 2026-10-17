import type { AgentWorkflow, WorkflowRun } from '../../shared/workflow-types'
import type { WorkflowService } from '../workflows/workflow-service'

/** The service members the RPC boundary needs, structural so tests stub without casts. */
export type WorkflowServiceSurface = Pick<
  WorkflowService,
  | 'listWorkflows'
  | 'getWorkflow'
  | 'createWorkflow'
  | 'deleteWorkflow'
  | 'runWorkflowNow'
  | 'listRuns'
>

/** RPC boundary for the Agent Workflow editor: thin delegation to WorkflowService. */
export class RuntimeWorkflowController {
  private service: WorkflowServiceSurface | null = null

  setService(service: WorkflowServiceSurface): void {
    this.service = service
  }

  list(): AgentWorkflow[] {
    return this.requireService().listWorkflows()
  }

  show(id: string): AgentWorkflow | null {
    return this.requireService().getWorkflow(id)
  }

  async importFile(parsed: {
    name: string
    executionTargetType: 'local' | 'ssh'
    executionTargetId: string
    nodes: AgentWorkflow['nodes']
    edges: AgentWorkflow['edges']
  }): Promise<AgentWorkflow> {
    return this.requireService().createWorkflow({
      name: parsed.name,
      description: '',
      schedule: null,
      enabled: false,
      executionTargetType: parsed.executionTargetType,
      executionTargetId: parsed.executionTargetId,
      nodes: parsed.nodes,
      edges: parsed.edges
    })
  }

  delete(id: string): boolean {
    return this.requireService().deleteWorkflow(id)
  }

  async runNow(id: string): Promise<WorkflowRun> {
    return this.requireService().runWorkflowNow(id)
  }

  runs(workflowId?: string): WorkflowRun[] {
    return this.requireService().listRuns(workflowId)
  }

  private requireService(): WorkflowServiceSurface {
    if (!this.service) {
      throw new Error('Workflow service is unavailable.')
    }
    return this.service
  }
}
