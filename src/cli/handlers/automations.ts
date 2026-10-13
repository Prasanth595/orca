import type {
  Automation,
  AutomationCreateInput,
  AutomationRun,
  AutomationSemanticEvaluationConfig,
  AutomationUpdateInput
} from '../../shared/automations-types'
import {
  buildWorkspaceRunContext,
  type WorkspaceRunContext
} from '../../shared/task-source-context'
import type {
  AutomationDestination,
  AutomationOwnerPrecondition
} from '../../shared/automation-owner-precondition'
import type { ProjectHostSetup } from '../../shared/project-types'
import type { CommandHandler } from '../dispatch'
import {
  formatAutomationList,
  formatAutomationRemoved,
  formatAutomationRun,
  formatAutomationShow,
  printResult,
  type AutomationShowPayload
} from '../format'
import {
  getOptionalPositiveIntegerFlag,
  getOptionalStringFlag,
  getRequiredStringFlag
} from '../flags'
import { resolveAutomationDestination } from '../automation-destination'
import { RuntimeClientError } from '../runtime-client'
import { getOptionalWorktreeSelector, resolveCurrentWorktreeSelector } from '../selectors'
import {
  assertWorkspaceTargetFlagsCompatible,
  hasWorkspaceProjectTarget,
  resolveProjectCreateTarget
} from '../worktree-project-target'
import {
  getEnabledFlag,
  getOptionalProviderFlag,
  getPrecheckFlag,
  getProviderFlag,
  getReuseSessionFlag,
  getScheduleFlag,
  getSourceContextFlag,
  getWorkspaceModeFlag
} from './automation-handler-flags'
import { getExtraAgentArgsFlag } from './automation-extra-agent-args-flag'
import {
  assertExtraAgentArgsSupported,
  assertSemanticEvaluationSupported
} from './automation-runtime-support'
import { AUTOMATION_RUN_HANDLERS } from './automation-run-handlers'

function getWorkflowReceiptRequiredFlag(flags: Map<string, string | boolean>): boolean | undefined {
  const required = flags.has('require-receipt')
  const optional = flags.has('no-require-receipt')
  if (required && optional) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Use either --require-receipt or --no-require-receipt, not both.'
    )
  }
  return required ? true : optional ? false : undefined
}

function getSemanticEvaluationFlag(
  flags: Map<string, string | boolean>
): AutomationSemanticEvaluationConfig | null | undefined {
  const disabled = flags.has('no-jev-evaluation')
  const mode = getOptionalStringFlag(flags, 'jev-evaluation')
  const rubricPath = getOptionalStringFlag(flags, 'jev-rubric')
  if (disabled && (mode !== undefined || rubricPath !== undefined)) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Use --no-jev-evaluation by itself, or provide both --jev-evaluation and --jev-rubric.'
    )
  }
  if (disabled) {
    return null
  }
  if (mode === undefined && rubricPath === undefined) {
    return undefined
  }
  if ((mode !== 'shadow' && mode !== 'enforced') || !rubricPath?.trim()) {
    throw new RuntimeClientError(
      'invalid_argument',
      '--jev-evaluation requires shadow or enforced, together with --jev-rubric <path>.'
    )
  }
  return { evaluator: 'jev', mode, rubricPath: rubricPath.trim() }
}

type AutomationCreateParams = Omit<AutomationCreateInput, 'projectId' | 'timezone'> & {
  destination?: AutomationDestination
  repo?: string
  timezone?: string
  workspace?: string
}

type AutomationUpdateParams = AutomationUpdateInput & {
  repo?: string
  workspace?: string
}

async function resolveDefaultTarget(
  flags: Map<string, string | boolean>,
  cwd: string,
  client: Parameters<CommandHandler>[0]['client']
): Promise<{ repo?: string; workspace?: string; runContext?: WorkspaceRunContext }> {
  assertWorkspaceTargetFlagsCompatible(flags)
  const repo = getOptionalStringFlag(flags, 'repo')
  if (repo && getOptionalStringFlag(flags, 'workspace')) {
    throw new RuntimeClientError('invalid_argument', 'Use either --repo or --workspace, not both.')
  }
  if (hasWorkspaceProjectTarget(flags) && getOptionalStringFlag(flags, 'workspace')) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Use either --workspace or project target flags, not both.'
    )
  }
  const projectTarget = await resolveProjectCreateTarget(flags, client)
  if (projectTarget) {
    return {
      repo: projectTarget.repoSelector,
      runContext: buildAutomationRunContextFromSetup(projectTarget.setup)
    }
  }
  const workspace = await getOptionalWorktreeSelector(flags, 'workspace', cwd, client)
  if (repo || workspace) {
    return { repo, workspace }
  }
  if (client.isRemote) {
    return {}
  }
  try {
    return { workspace: await resolveCurrentWorktreeSelector(cwd, client) }
  } catch {
    return {}
  }
}

async function getExplicitTarget(
  flags: Map<string, string | boolean>,
  cwd: string,
  client: Parameters<CommandHandler>[0]['client']
): Promise<{ repo?: string; workspace?: string; runContext?: WorkspaceRunContext }> {
  assertWorkspaceTargetFlagsCompatible(flags)
  const repo = getOptionalStringFlag(flags, 'repo')
  if (repo && getOptionalStringFlag(flags, 'workspace')) {
    throw new RuntimeClientError('invalid_argument', 'Use either --repo or --workspace, not both.')
  }
  if (hasWorkspaceProjectTarget(flags) && getOptionalStringFlag(flags, 'workspace')) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Use either --workspace or project target flags, not both.'
    )
  }
  const projectTarget = await resolveProjectCreateTarget(flags, client)
  if (projectTarget) {
    return {
      repo: projectTarget.repoSelector,
      runContext: buildAutomationRunContextFromSetup(projectTarget.setup)
    }
  }
  const workspace = await getOptionalWorktreeSelector(flags, 'workspace', cwd, client)
  return { repo, workspace }
}

/**
 * Reads the record's current owner so the mutation that follows can name it.
 *
 * The CLI cannot project an owner itself — it has no SSH target registry — so it
 * asks the authority that stores the record. A host too old to answer sends
 * nothing, and that host has no fence to satisfy either.
 */
async function resolveExpectedOwner(
  client: Parameters<CommandHandler>[0]['client'],
  id: string
): Promise<AutomationOwnerPrecondition | undefined> {
  const result = await client.call<{ automation: Automation; owner?: AutomationOwnerPrecondition }>(
    'automation.show',
    { id }
  )
  return result.result.owner
}

function buildAutomationRunContextFromSetup(setup: ProjectHostSetup): WorkspaceRunContext {
  const runContext = buildWorkspaceRunContext({
    projectId: setup.projectId,
    hostId: setup.hostId,
    projectHostSetupId: setup.id,
    repoId: setup.repoId,
    path: setup.path
  })
  if (!runContext) {
    throw new RuntimeClientError(
      'invalid_argument',
      `Project host setup is missing automation run context fields: ${setup.id}`
    )
  }
  return runContext
}

export const AUTOMATION_HANDLERS: Record<string, CommandHandler> = {
  ...AUTOMATION_RUN_HANDLERS,
  'automations list': async ({ client, json }) => {
    const result = await client.call<{ automations: Automation[] }>('automation.list')
    printResult(result, json, formatAutomationList)
  },
  'automations show': async ({ flags, client, json }) => {
    const result = await client.call<AutomationShowPayload>('automation.show', {
      id: getRequiredStringFlag(flags, 'id')
    })
    printResult(result, json, formatAutomationShow)
  },
  'automations create': async ({ flags, client, cwd, json }) => {
    const schedule = getScheduleFlag(flags, true)
    if (!schedule) {
      throw new RuntimeClientError('invalid_argument', 'Missing required --trigger')
    }
    const target = await resolveDefaultTarget(flags, cwd, client)
    const sourceContext = getSourceContextFlag(flags)
    const workspaceMode =
      getWorkspaceModeFlag(flags) ?? (target.workspace ? 'existing' : 'new_per_run')
    // Built before the destination read so a contradictory flag still fails without a runtime call.
    const create = {
      name: getRequiredStringFlag(flags, 'name'),
      prompt: getRequiredStringFlag(flags, 'prompt'),
      precheck: getPrecheckFlag(flags),
      agentId: getProviderFlag(flags),
      extraAgentArgs: getExtraAgentArgsFlag(flags),
      ...(target.runContext ? { runContext: target.runContext } : {}),
      ...(sourceContext !== undefined ? { sourceContext } : {}),
      repo: target.repo,
      workspace: target.workspace,
      workspaceMode,
      baseBranch: getOptionalStringFlag(flags, 'base-branch'),
      reuseSession: getReuseSessionFlag(flags),
      timezone: getOptionalStringFlag(flags, 'timezone'),
      enabled: getEnabledFlag(flags),
      missedRunGraceMinutes: getOptionalPositiveIntegerFlag(flags, 'missed-run-grace-minutes'),
      workflowReceiptRequired: getWorkflowReceiptRequiredFlag(flags),
      semanticEvaluation: getSemanticEvaluationFlag(flags),
      ...schedule
    } satisfies AutomationCreateParams
    await assertExtraAgentArgsSupported(client, create.extraAgentArgs)
    await assertSemanticEvaluationSupported(client, create.semanticEvaluation)
    const destination = await resolveAutomationDestination(client, target)
    const result = await client.call<{ automation: Automation }>('automation.create', {
      ...create,
      ...(destination ? { destination } : {})
    })
    printResult(result, json, formatAutomationShow)
  },
  'automations edit': async ({ flags, client, cwd, json }) => {
    const target = await getExplicitTarget(flags, cwd, client)
    const schedule = getScheduleFlag(flags, false)
    const sourceContext = getSourceContextFlag(flags)
    const id = getRequiredStringFlag(flags, 'id')
    // Built before the owner read so a contradictory flag still fails without a runtime call.
    const updates = {
      name: getOptionalStringFlag(flags, 'name'),
      prompt: getOptionalStringFlag(flags, 'prompt'),
      precheck: getPrecheckFlag(flags),
      agentId: getOptionalProviderFlag(flags),
      extraAgentArgs: getExtraAgentArgsFlag(flags),
      ...(target.runContext ? { runContext: target.runContext } : {}),
      ...(sourceContext !== undefined ? { sourceContext } : {}),
      repo: target.repo,
      workspace: target.workspace,
      workspaceMode: getWorkspaceModeFlag(flags),
      baseBranch: getOptionalStringFlag(flags, 'base-branch'),
      reuseSession: getReuseSessionFlag(flags),
      timezone: getOptionalStringFlag(flags, 'timezone'),
      enabled: getEnabledFlag(flags),
      missedRunGraceMinutes: getOptionalPositiveIntegerFlag(flags, 'missed-run-grace-minutes'),
      workflowReceiptRequired: getWorkflowReceiptRequiredFlag(flags),
      semanticEvaluation: getSemanticEvaluationFlag(flags),
      ...schedule
    } satisfies AutomationUpdateParams
    await assertExtraAgentArgsSupported(client, updates.extraAgentArgs)
    await assertSemanticEvaluationSupported(client, updates.semanticEvaluation)
    const expectedOwner = await resolveExpectedOwner(client, id)
    // Why: expectedOwner only fences the host the record is leaving; an edit that moves it needs the arrival fenced too.
    const destination = await resolveAutomationDestination(client, target)
    const result = await client.call<{ automation: Automation }>('automation.update', {
      id,
      ...(expectedOwner ? { expectedOwner } : {}),
      ...(destination ? { destination } : {}),
      updates
    })
    printResult(result, json, formatAutomationShow)
  },
  'automations remove': async ({ flags, client, json }) => {
    const id = getRequiredStringFlag(flags, 'id')
    const expectedOwner = await resolveExpectedOwner(client, id)
    const result = await client.call<{ removed: boolean; id: string }>('automation.delete', {
      id,
      ...(expectedOwner ? { expectedOwner } : {})
    })
    printResult(result, json, formatAutomationRemoved)
  },
  'automations run': async ({ flags, client, json }) => {
    const id = getRequiredStringFlag(flags, 'id')
    const expectedOwner = await resolveExpectedOwner(client, id)
    const result = await client.call<{ run: AutomationRun }>('automation.runNow', {
      id,
      ...(expectedOwner ? { expectedOwner } : {})
    })
    printResult(result, json, formatAutomationRun)
  }
}
