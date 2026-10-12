import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { AgentPromptWriteSettlementError } from './agent-prompt-write-settlement'
import { OrcaRuntimeService } from './orca-runtime'
import { settledWriteStub } from '../providers/settled-pty-write-stub'
import { writeRefused } from '../../shared/pty-write-settlement'
import {
  createBoundRun,
  createDatabase,
  createRuntime,
  driveToLiveIdle,
  PTY_ID,
  PANE_KEY,
  TAB_ID,
  LEAF_ID,
  TERMINAL_HANDLE,
  temporaryDirectories
} from './orchestration-mailbox-notification-test-harness'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => tmpdir()), isPackaged: false },
  BrowserWindow: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  webContents: { fromId: vi.fn(() => null) }
}))

afterEach(() => {
  vi.useRealTimers()
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

it('supports a runtime-owned Codex handle and rejects missing or rebound identities', async () => {
  const runtime = new OrcaRuntimeService(null)
  runtime.setPtyController({
    write: () => true,
    writeWithSettlement: settledWriteStub(() => true),
    kill: () => true,
    getForegroundProcess: async () => null
  })
  runtime.registerPty('owned-pty', 'owned-workspace', null, {
    tabId: TAB_ID,
    leafId: LEAF_ID,
    incarnationId: 'owned-incarnation',
    agentLaunchAuthority: { launchToken: 'owned-token', launchAgent: 'codex' }
  })
  runtime.registerPreAllocatedHandleForPty('owned-pty', 'term_owned')
  await runtime.listTerminals()
  expect(runtime.supportsCoordinatorDelivery('term_owned')).toBe(true)
  expect(runtime.supportsCoordinatorDelivery('term_missing')).toBe(false)
  await runtime.onPtyExit('owned-pty', 0)
  expect(runtime.supportsCoordinatorDelivery('term_owned')).toBe(false)
})

it.each(['unsupported', 'blocked'])(
  'does not hot-loop a persistent pre-write %s refusal',
  async (reason) => {
    vi.useFakeTimers()
    const db = createDatabase('orca-coordinator-refusal-')
    const { runtime } = createRuntime(db)
    const run = createBoundRun(db, 'Hub', 'coordination')
    const send = vi.spyOn(runtime, 'sendTerminalAgentPrompt').mockRejectedValue(new Error(reason))
    const row = db.insertMessage({
      from: 'worker',
      to: `run:${run.id}`,
      runId: run.id,
      type: 'question',
      subject: 'Help'
    })
    try {
      await driveToLiveIdle(runtime)
      expect(runtime.supportsCoordinatorDelivery(TERMINAL_HANDLE)).toBe(true)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(send).toHaveBeenCalledTimes(1)
      expect(db.getMessageById(row.id)?.pointer_enter_pending).toBe(0)
      expect(db.getMessageById(row.id)?.delivered_at).toBeNull()
    } finally {
      db.close()
    }
  }
)

it('queues material event and timer overlap while busy under one mailbox flight', async () => {
  vi.useFakeTimers()
  const db = createDatabase('orca-coordinator-busy-')
  const { runtime } = createRuntime(db)
  const run = createBoundRun(db, 'Hub', 'coordination')
  const send = vi
    .spyOn(runtime, 'sendTerminalAgentPrompt')
    .mockImplementation(async (handle, text, options) => {
      await options?.beforeWrite?.(PTY_ID)
      await options?.beforeWrite?.(PTY_ID)
      return {
        handle,
        accepted: true,
        bytesWritten: text.length + 1,
        prompt: {
          requestId: options?.requestId ?? '',
          provider: 'codex',
          observation: 'supported',
          stages: ['input_accepted'],
          ...runtime.getTerminalPromptRequestBinding(handle),
          baselineWorkingSequence: 0,
          baselineExplicitWorkingStartedAt: null,
          baselinePermissionSequence: 0
        }
      }
    })
  try {
    await runtime.listTerminals()
    runtime.onPtyData(PTY_ID, '\x1b]0;Codex working\x07', Date.now())
    await runtime.serializeMainTerminalBuffer(PTY_ID)
    db.insertMessage({
      from: 'worker',
      to: `run:${run.id}`,
      runId: run.id,
      type: 'question',
      subject: 'Question'
    })
    db.insertMessage({
      from: 'timer',
      to: `run:${run.id}`,
      runId: run.id,
      type: 'status',
      subject: 'Tick',
      payload: JSON.stringify({
        coordinatorPass: {
          handle: TERMINAL_HANDLE,
          consumerGeneration: run.consumer_generation,
          processIncarnation: runtime.getTerminalProcessIncarnation(TERMINAL_HANDLE)
        }
      })
    })
    runtime.notifyMessageArrived(`run:${run.id}`, 'question')
    runtime.notifyMessageArrived(`run:${run.id}`, 'status')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(send).not.toHaveBeenCalled()
    await driveToLiveIdle(runtime)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[1]).toContain('2 orchestration messages')
  } finally {
    db.close()
  }
})

it('preserves accepted paste when the owning Run changes before Enter', async () => {
  vi.useFakeTimers()
  const db = createDatabase('orca-coordinator-owner-')
  const { runtime } = createRuntime(db)
  const run = createBoundRun(db, 'Hub', 'coordination')
  const row = db.insertMessage({
    from: 'worker',
    to: `run:${run.id}`,
    runId: run.id,
    type: 'escalation',
    subject: 'Risk'
  })
  let frames = 0
  const send = vi
    .spyOn(runtime, 'sendTerminalAgentPrompt')
    .mockImplementation(async (_handle, _text, options) => {
      await options?.beforeWrite?.(PTY_ID)
      frames++
      db.createRun({
        objective: 'Rebound',
        coordinatorHandle: TERMINAL_HANDLE,
        coordinatorPaneKey: PANE_KEY
      })
      await options?.beforeWrite?.(PTY_ID)
      throw new Error('Enter must not be reached')
    })
  try {
    await driveToLiveIdle(runtime)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(send).toHaveBeenCalledTimes(1)
    expect(frames).toBe(1)
    expect(db.getMessageById(row.id)?.pointer_enter_pending).toBe(2)
    expect(db.getMessageById(row.id)?.delivered_at).toBeNull()
  } finally {
    db.close()
  }
})

it('does not submit accepted paste through a newly observed permission prompt', async () => {
  vi.useFakeTimers()
  const db = createDatabase('orca-coordinator-permission-')
  const { runtime } = createRuntime(db)
  const run = createBoundRun(db, 'Hub', 'coordination')
  const row = db.insertMessage({
    from: 'worker',
    to: `run:${run.id}`,
    runId: run.id,
    type: 'question',
    subject: 'Help'
  })
  vi.spyOn(runtime, 'getTerminalAgentStatus')
    .mockResolvedValueOnce({ handle: TERMINAL_HANDLE, isRunningAgent: true, status: 'idle' })
    .mockResolvedValue({ handle: TERMINAL_HANDLE, isRunningAgent: true, status: 'permission' })
  let frames = 0
  const send = vi
    .spyOn(runtime, 'sendTerminalAgentPrompt')
    .mockImplementation(async (_handle, _text, options) => {
      await options?.beforeWrite?.(PTY_ID)
      frames++
      await options?.beforeWrite?.(PTY_ID)
      throw new Error('Enter must not be reached')
    })
  try {
    await driveToLiveIdle(runtime)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(send).toHaveBeenCalledTimes(1)
    expect(frames).toBe(1)
    expect(db.getMessageById(row.id)?.pointer_enter_pending).toBe(2)
    expect(db.getMessageById(row.id)?.delivered_at).toBeNull()
  } finally {
    db.close()
  }
})

it.each(['accepted-only', 'suffix-refused', 'turn-started'] as const)(
  'settles only observed turn start, preserving %s effects across later idle edges',
  async (outcome) => {
    vi.useFakeTimers()
    const db = createDatabase('orca-coordinator-effect-')
    const { runtime } = createRuntime(db)
    const run = createBoundRun(db, 'Hub', 'coordination')
    const row = db.insertMessage({
      from: 'worker',
      to: `run:${run.id}`,
      runId: run.id,
      type: 'question',
      subject: 'Help'
    })
    const send = vi
      .spyOn(runtime, 'sendTerminalAgentPrompt')
      .mockImplementation(async (handle, text, options) => {
        expect(text).toContain('orchestration check')
        expect(options?.composerReady).toBeUndefined()
        expect(options?.requireWriteSettlement).toBe(true)
        await options?.beforeWrite?.(PTY_ID)
        expect(db.getMessageById(row.id)?.pointer_enter_pending).toBe(2)
        await options?.beforeWrite?.(PTY_ID)
        expect(db.getMessageById(row.id)?.pointer_enter_pending).toBe(3)
        if (outcome === 'suffix-refused') {
          throw new AgentPromptWriteSettlementError(writeRefused('provider_refused_write'))
        }
        return {
          handle,
          accepted: true,
          bytesWritten: text.length + 1,
          prompt: {
            requestId: options?.requestId ?? '',
            provider: 'codex',
            observation: 'supported',
            stages:
              outcome === 'turn-started' ? ['input_accepted', 'turn_started'] : ['input_accepted'],
            ...runtime.getTerminalPromptRequestBinding(handle),
            baselineWorkingSequence: 0,
            baselineExplicitWorkingStartedAt: null,
            baselinePermissionSequence: 0
          }
        }
      })
    try {
      await driveToLiveIdle(runtime)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(send).toHaveBeenCalledTimes(1)
      const saved = db.getMessageById(row.id)
      expect(saved?.pointer_enter_pending).toBe(outcome === 'turn-started' ? 0 : 3)
      expect(saved?.delivered_at !== null).toBe(outcome === 'turn-started')
      await driveToLiveIdle(runtime)
      await vi.advanceTimersByTimeAsync(30_000)
      expect(send).toHaveBeenCalledTimes(1)
      if (outcome !== 'turn-started') {
        db.releasePendingMailboxPointerForPty(PTY_ID)
        expect(db.getMessageById(row.id)?.pointer_enter_pending).toBe(3)
        expect(db.getMessageById(row.id)?.delivered_at).toBeNull()
        const restarted = createRuntime(db).runtime
        const resubmit = vi.spyOn(restarted, 'sendTerminalAgentPrompt')
        vi.spyOn(restarted, 'getTerminalProcessIncarnation').mockReturnValue(
          'replacement-incarnation'
        )
        await driveToLiveIdle(restarted)
        await vi.advanceTimersByTimeAsync(30_000)
        expect(resubmit).not.toHaveBeenCalled()
        expect(db.getMessageById(row.id)?.pointer_enter_pending).toBe(3)
      }
    } finally {
      db.close()
    }
  }
)
