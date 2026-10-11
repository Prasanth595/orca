import { ipcMain } from 'electron'
import { runProcess } from '../../shared/child-process/run-process'
import {
  CLAUDE_MODEL_LIST_STDIN,
  CLAUDE_MODEL_LIST_ARGS,
  parseClaudeModelList
} from '../../shared/claude-model-list-probe'
import { connectionManager } from './ssh-ipc-context'
import { buildSshRemoteExec } from '../workflows/workflow-remote-exec'
import type { WorkflowService } from '../workflows/workflow-service'
import type { AgentWorkflow } from '../../shared/workflow-types'
import type { TuiAgent } from '../../shared/tui-agent'

export type WorkflowModel = { id: string; label: string }

const MODEL_LIST_TIMEOUT_MS = 10_000

// Agents that support non-interactive execution in workflows, in probe order
const WORKFLOW_AGENTS: TuiAgent[] = ['claude', 'cursor', 'codex', 'gemini', 'amp', 'opencode']

// Map agent id → executable name for `which` probing
const AGENT_EXECUTABLES: Record<TuiAgent, string> = {
  claude: 'claude',
  cursor: 'cursor-agent',
  codex: 'codex',
  gemini: 'gemini',
  amp: 'amp',
  opencode: 'opencode',
  // All other agents fall through; only the six above are probed for workflows
  'claude-agent-teams': 'claude',
  codebuddy: 'codebuddy',
  openclaude: 'openclaude',
  autohand: 'autohand',
  opencode2: 'opencode',
  'mimo-code': 'mimo-code',
  pi: 'pi',
  omp: 'omp',
  qoder: 'qoder',
  'qoder-cn': 'qoder',
  antigravity: 'antigravity',
  aider: 'aider',
  goose: 'goose',
  kilo: 'kilo',
  kiro: 'kiro',
  crush: 'crush',
  aug: 'aug',
  cline: 'cline',
  codebuff: 'codebuff',
  freebuff: 'freebuff',
  'command-code': 'command-code',
  continue: 'continue',
  droid: 'droid',
  kimi: 'kimi',
  'mistral-vibe': 'mistral-vibe',
  'qwen-code': 'qwen-code',
  rovo: 'rovo',
  hermes: 'hermes',
  openclaw: 'openclaw',
  copilot: 'gh',
  grok: 'grok',
  devin: 'devin',
  ante: 'ante',
  trae: 'trae',
  muse: 'muse',
  zcode: 'zcode',
  'prime-agent': 'prime-agent',
  dsh: 'dsh',
  jcode: 'jcode'
}

async function detectLocalAgents(): Promise<TuiAgent[]> {
  const whichCmd = process.platform === 'win32' ? 'where' : 'which'
  const found: TuiAgent[] = []
  await Promise.all(
    WORKFLOW_AGENTS.map(async (agentId) => {
      const exe = AGENT_EXECUTABLES[agentId]
      try {
        const result = await runProcess({
          program: whichCmd,
          args: [exe],
          timeoutMs: 3000
        })
        if (result.code === 0 && result.stdout.trim()) {
          found.push(agentId)
        }
      } catch {
        // not found
      }
    })
  )
  return WORKFLOW_AGENTS.filter((a) => found.includes(a))
}

async function detectRemoteAgents(targetId: string): Promise<TuiAgent[]> {
  if (!connectionManager) {
    return []
  }
  const remoteExec = buildSshRemoteExec(connectionManager, targetId)
  // Build a single remote probe: `command -v <exe> && echo "<id>:ok"` for each agent
  const probes = WORKFLOW_AGENTS.map((a) => {
    const exe = AGENT_EXECUTABLES[a]
    return `command -v ${exe} >/dev/null 2>&1 && echo "${a}:ok"`
  }).join('; ')
  try {
    const result = await remoteExec(probes, { timeoutMs: 8000 })
    const found = new Set(
      result.stdout
        .split(/\r?\n/)
        .filter((l) => l.endsWith(':ok'))
        .map((l) => l.replace(/:ok$/, ''))
    )
    return WORKFLOW_AGENTS.filter((a) => found.has(a))
  } catch {
    return []
  }
}

function parseCursorAgentModels(stdout: string): WorkflowModel[] {
  const seen = new Set<string>()
  const models: WorkflowModel[] = []
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim()
    // format: "model-id - Display Name" or just "model-id"
    const dashIdx = line.indexOf(' - ')
    const id = dashIdx !== -1 ? line.slice(0, dashIdx).trim() : line
    const label = dashIdx !== -1 ? line.slice(dashIdx + 3).trim() : line
    if (!id || !/^[a-z0-9][a-z0-9._-]*$/i.test(id) || seen.has(id)) {
      continue
    }
    seen.add(id)
    models.push({ id, label: label || id })
  }
  return models
}

async function fetchModelsForAgent(agentId: TuiAgent): Promise<WorkflowModel[]> {
  if (agentId === 'claude') {
    const result = await runProcess({
      program: 'claude',
      args: CLAUDE_MODEL_LIST_ARGS,
      input: CLAUDE_MODEL_LIST_STDIN,
      timeoutMs: MODEL_LIST_TIMEOUT_MS
    })
    return parseClaudeModelList(result.stdout).map((m) => ({ id: m.id, label: m.label }))
  }
  if (agentId === 'cursor') {
    const result = await runProcess({
      program: 'cursor-agent',
      args: ['models'],
      timeoutMs: MODEL_LIST_TIMEOUT_MS
    })
    return parseCursorAgentModels(result.stdout)
  }
  if (agentId === 'codex') {
    const result = await runProcess({
      program: 'codex',
      args: ['models', '--json'],
      timeoutMs: MODEL_LIST_TIMEOUT_MS
    })
    try {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: parsing unknown CLI JSON output; shape verified by field checks below
      const parsed = JSON.parse(result.stdout) as {
        models?: { slug?: string; display_name?: string }[]
      }
      return (parsed.models ?? [])
        .filter(
          (m): m is { slug: string; display_name: string } =>
            typeof m.slug === 'string' && typeof m.display_name === 'string'
        )
        .map((m) => ({ id: m.slug, label: m.display_name }))
    } catch {
      return []
    }
  }
  return []
}

export function registerWorkflowHandlers(service: WorkflowService): void {
  // Wire SSH connection manager into service so SSH-target workflows use remote exec
  if (connectionManager) {
    service.setSshConnectionManager(connectionManager)
  }
  ipcMain.handle('workflows:list', () => service.listWorkflows())

  ipcMain.handle('workflows:getRuns', (_e, workflowId?: string) => service.listRuns(workflowId))

  ipcMain.handle(
    'workflows:create',
    (_e, partial: Omit<AgentWorkflow, 'id' | 'createdAt' | 'updatedAt'>) =>
      service.createWorkflow(partial)
  )

  ipcMain.handle('workflows:update', (_e, id: string, patch: Partial<AgentWorkflow>) => {
    // When nodes are patched, auto-clear scheduling if no cron trigger remains
    if (patch.nodes !== undefined) {
      const hasCron = patch.nodes.some((n) => n.type === 'trigger_cron')
      if (!hasCron) {
        patch = { ...patch, schedule: null, enabled: false }
      }
    }
    return service.updateWorkflow(id, patch)
  })

  ipcMain.handle('workflows:delete', (_e, id: string) => service.deleteWorkflow(id))

  ipcMain.handle('workflows:runNow', async (_e, workflowId: string) => {
    const workflow = service.getWorkflow(workflowId)
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found.`)
    }
    const run = await service.runWorkflow(workflow, 'manual')
    // First run activates scheduling if a cron trigger is present
    const hasCron = workflow.nodes.some((n) => n.type === 'trigger_cron')
    if (hasCron && !workflow.enabled) {
      service.activateSchedule(workflowId)
    }
    return run
  })

  ipcMain.handle('workflows:stop', (_e, workflowId: string) => {
    const result = service.deactivateSchedule(workflowId)
    return result !== null
  })

  ipcMain.handle('workflows:cancelRun', (_e, runId: string) => {
    service.cancelRun(runId)
  })

  ipcMain.handle(
    'workflows:listModels',
    async (_e, agentId: TuiAgent): Promise<WorkflowModel[]> => {
      try {
        return await fetchModelsForAgent(agentId)
      } catch {
        return []
      }
    }
  )

  ipcMain.handle('workflows:detectAgents', async (_e, targetId?: string): Promise<TuiAgent[]> => {
    try {
      return targetId ? await detectRemoteAgents(targetId) : await detectLocalAgents()
    } catch {
      return []
    }
  })
}

export function unregisterWorkflowHandlers(): void {
  for (const channel of [
    'workflows:list',
    'workflows:getRuns',
    'workflows:create',
    'workflows:update',
    'workflows:delete',
    'workflows:runNow',
    'workflows:cancelRun',
    'workflows:listModels',
    'workflows:detectAgents',
    'workflows:stop'
  ]) {
    ipcMain.removeHandler(channel)
  }
}
