import { runProcess } from '@orca/process-host'
import {
  CLAUDE_MODEL_LIST_STDIN,
  CLAUDE_MODEL_LIST_ARGS,
  parseClaudeModelList
} from '../../shared/claude-model-list-probe'
import { quotePosixShell } from '../../shared/wsl-login-shell-command'
import type { TuiAgent } from '../../shared/tui-agent'
import type { RemoteExecFn } from './workflow-remote-exec'

export type WorkflowModel = { id: string; label: string }

/**
 * Runs one program on the workflow's execution host and reports its exit and stdout. Local
 * workflows use this machine; SSH workflows run the same probe on the SSH host.
 */
export type AgentHostRunner = (
  program: string,
  args: string[],
  options?: { input?: string; timeoutMs?: number }
) => Promise<{ code: number | null; stdout: string }>

export const localAgentHostRunner: AgentHostRunner = async (program, args, options = {}) => {
  const result = await runProcess({
    program,
    args,
    input: options.input,
    timeoutMs: options.timeoutMs ?? MODEL_LIST_TIMEOUT_MS
  })
  return { code: result.code, stdout: result.stdout }
}

export function remoteAgentHostRunner(remoteExec: RemoteExecFn): AgentHostRunner {
  return async (program, args, options = {}) => {
    const result = await remoteExec([program, ...args].map(quotePosixShell).join(' '), {
      stdin: options.input,
      timeoutMs: options.timeoutMs ?? MODEL_LIST_TIMEOUT_MS
    })
    return { code: result.exitCode, stdout: result.stdout }
  }
}

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

export async function detectLocalAgents(): Promise<TuiAgent[]> {
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

export async function detectRemoteAgents(remoteExec: RemoteExecFn): Promise<TuiAgent[]> {
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

/** Models an agent CLI reports on the workflow's host. */
export async function fetchModelsForAgent(
  agentId: TuiAgent,
  run: AgentHostRunner = localAgentHostRunner
): Promise<WorkflowModel[]> {
  if (agentId === 'claude') {
    const result = await run('claude', [...CLAUDE_MODEL_LIST_ARGS], {
      input: CLAUDE_MODEL_LIST_STDIN
    })
    return parseClaudeModelList(result.stdout).map((m) => ({ id: m.id, label: m.label }))
  }
  if (agentId === 'cursor') {
    const result = await run('cursor-agent', ['models'])
    return parseCursorAgentModels(result.stdout)
  }
  if (agentId === 'codex') {
    const result = await run('codex', ['models', '--json'])
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
