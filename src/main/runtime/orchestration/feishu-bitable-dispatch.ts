import type { z } from 'zod'
import type { TuiAgent } from '../../../shared/tui-agent'
import type { FeishuBitableExecutionInput } from '../../../shared/feishu-bitable-task-contract'
import { buildFeishuBitableExecutionPlan } from '../../../shared/feishu-bitable-execution-plan'
import { WorkerStartParams } from '../../../shared/rpc-contract/orchestration-worker-start-params'

export type FeishuBitablePlacement = {
  /** Omit only for execution on the dispatch operation's own host. */
  on?: string
} & (
  | { kind: 'existing'; worktree: string }
  | {
      kind: 'new'
      worktree: 'new-child' | 'new-top-level'
      repo: string
      baseBranch?: string
      setup: 'run' | 'skip' | 'inherit'
    }
)

export type FeishuBitableDispatchRequest = {
  input: FeishuBitableExecutionInput
  from: string
  placement: FeishuBitablePlacement
  agent: TuiAgent
  model?: string
  effort?: string
}

export type FeishuBitableWorkerStartParams = z.infer<typeof WorkerStartParams>

function requireSelector(value: string, label: string): void {
  if (!value.trim() || value !== value.trim() || /[\p{Cc}\p{Cf}]/u.test(value)) {
    throw new Error(`Invalid Feishu execution ${label}`)
  }
}

/** The caller injects its existing orchestration.workerStart operation, including host routing. */
export async function dispatchFeishuBitableTask<Result>(
  request: FeishuBitableDispatchRequest,
  dispatch: (params: FeishuBitableWorkerStartParams) => Promise<Result>
): Promise<{ plan: ReturnType<typeof buildFeishuBitableExecutionPlan>; receipt: Result }> {
  requireSelector(request.from, 'from')
  requireSelector(request.agent, 'agent')
  requireSelector(request.placement.worktree, 'workspace')
  if (request.placement.on !== undefined) {
    requireSelector(request.placement.on, 'host')
  }
  if (
    request.placement.kind === 'existing' &&
    ['current', 'new-child', 'new-top-level'].includes(request.placement.worktree)
  ) {
    throw new Error('Feishu execution requires an explicit existing workspace selector')
  }
  if (request.placement.kind === 'new') {
    requireSelector(request.placement.repo, 'repository')
  }
  const plan = buildFeishuBitableExecutionPlan(request.input)
  const params = WorkerStartParams.parse({
    from: request.from,
    on: request.placement.on,
    worktree: request.placement.worktree,
    agent: request.agent,
    model: request.model,
    effort: request.effort,
    spec: plan.taskSpec,
    ...(request.placement.kind === 'new'
      ? {
          repo: request.placement.repo,
          baseBranch: request.placement.baseBranch,
          setup: request.placement.setup,
          name: plan.suggestedWorkspaceName
        }
      : {})
  })
  const receipt = await dispatch(params)
  return { plan, receipt }
}
