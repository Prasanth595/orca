import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from '../../orca-runtime'
import { OrchestrationDb } from '../../orchestration/db'
import { ORCHESTRATION_METHODS } from './orchestration'

const TERMINAL_HANDLE = 'term_worker'
const createExistingWorktreeWorkerTerminal = vi.fn(async () => ({ handle: TERMINAL_HANDLE }))

vi.mock('./orchestration/worker/worker-topology', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createExistingWorktreeWorkerTerminal: () => createExistingWorktreeWorkerTerminal()
}))
vi.mock('./orchestration-caller-workspace', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveDispatchCallerWorktreeId: async () => 'repo::wt'
}))

describe('worker-start --retry-of launch inheritance', () => {
  const coordinatorPaneKey = 'tab_coord:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  let db: OrchestrationDb
  let runtime: OrcaRuntimeService
  let runId: string
  let agentReady: boolean

  beforeEach(() => {
    agentReady = false
    db = new OrchestrationDb(':memory:')
    runtime = new OrcaRuntimeService()
    runtime.setOrchestrationDb(db)
    runId = db.createRun({
      objective: 'Retry inherits launch selection',
      coordinatorHandle: 'term_coord',
      coordinatorPaneKey
    }).id
    vi.spyOn(runtime, 'getTerminalPaneKey').mockImplementation((handle) =>
      handle === 'term_coord' ? coordinatorPaneKey : `tab_worker:${handle}`
    )
    vi.spyOn(runtime, 'getTerminalProcessIncarnation').mockReturnValue('runtime_test:worker:1')
    vi.spyOn(runtime, 'validateOrchestrationAgentLauncher').mockImplementation(() => {})
    vi.spyOn(runtime, 'showManagedTerminalWorkspace').mockResolvedValue({
      id: 'repo::wt',
      repoId: 'repo'
    })
    vi.spyOn(runtime, 'waitForTerminal').mockImplementation(async () => ({
      handle: TERMINAL_HANDLE,
      condition: 'tui-idle' as const,
      satisfied: agentReady,
      status: 'running' as const,
      exitCode: null
    }))
    vi.spyOn(runtime, 'getTerminalOrchestrationCliCommand').mockReturnValue('orca')
    vi.spyOn(runtime, 'sendTerminalAgentPrompt').mockResolvedValue({
      handle: TERMINAL_HANDLE,
      accepted: true,
      bytesWritten: 1
    })
  })

  afterEach(() => {
    db.close()
    vi.restoreAllMocks()
  })

  async function workerStart(overrides: Record<string, unknown>) {
    const method = ORCHESTRATION_METHODS.find(
      (candidate) => candidate.name === 'orchestration.workerStart'
    )!
    const params = method.params!.parse({ from: 'term_coord', worktree: 'current', ...overrides })
    const receipt = await method.handler(params, { runtime })
    expect(receipt).toMatchObject({ dispatchId: expect.any(String) })
    return receipt && typeof receipt === 'object' && 'dispatchId' in receipt && 'state' in receipt
      ? { state: String(receipt.state), dispatchId: String(receipt.dispatchId) }
      : { state: 'missing', dispatchId: '' }
  }

  it('relaunches the retried Dispatch agent and model when --agent is omitted', async () => {
    const task = db.createTask({ spec: 'retry me', runId })
    const first = await workerStart({ task: task.id, agent: 'claude', model: 'sonnet' })
    expect(first.state).toBe('failed')

    agentReady = true
    const retry = await workerStart({ task: task.id, retryOf: first.dispatchId })

    expect(retry.state).toBe('ready')
    const startOptions = JSON.parse(db.getWorkerDispatch(retry.dispatchId)!.start_options)
    expect(startOptions.launch.requested).toEqual({
      agent: 'claude',
      model: 'sonnet',
      effort: null
    })
  })
})
