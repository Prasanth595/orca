import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toRemoteRuntimePtyId } from './runtime-terminal-stream'
import {
  clearWebSessionTerminalOrphanRecoveryForTests,
  recoverWebSessionTerminalOrphansBeforeApply
} from './web-session-terminal-orphan-recovery'
import type { TerminalOrphanRecoveryState } from './web-session-terminal-orphan-recovery'
import { clearWorktreeSleepIntent, markWorktreeSleepIntent } from '../lib/worktree-sleep-intent'
import { makePaneKey } from '../../../shared/stable-pane-id'
import type { SleepingAgentSessionRecord } from '../../../shared/agent-session-resume'
import type { TerminalTab } from '../../../shared/terminal-tab-types'
import type {
  RuntimeTerminalListResult,
  RuntimeTerminalSummary
} from '../../../shared/runtime-types'
import type { TerminalOrphanRecoveryCall } from './web-session-terminal-orphan-recovery-adoption'

const ENVIRONMENT_ID = 'remote-runtime'
const WORKTREE_ID = 'repo::/worktree'
const HOST_TAB_ID = 'host-tab'
const MIRRORED_TAB_ID = `web-terminal-${HOST_TAB_ID}`
const LEAF_ID = '11111111-1111-4111-8111-111111111111'
const TERMINAL_HANDLE = 'term-live'
const REMOTE_PTY_ID = toRemoteRuntimePtyId(TERMINAL_HANDLE, ENVIRONMENT_ID)

/** A slept workspace's mirror: the tab and the layout wake binding survive, the PTY does not. */
function mirroredTab(): TerminalTab {
  return {
    id: MIRRORED_TAB_ID,
    ptyId: REMOTE_PTY_ID,
    worktreeId: WORKTREE_ID,
    title: 'Codex',
    defaultTitle: 'Terminal',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 1
  }
}

function stateWithVerifiedBinding(): TerminalOrphanRecoveryState {
  return {
    tabsByWorktree: { [WORKTREE_ID]: [mirroredTab()] },
    terminalLayoutsByTabId: {
      [MIRRORED_TAB_ID]: {
        root: { type: 'leaf' as const, leafId: LEAF_ID },
        activeLeafId: LEAF_ID,
        expandedLeafId: null,
        ptyIdsByLeafId: { [LEAF_ID]: REMOTE_PTY_ID }
      }
    },
    activeTabIdByWorktree: { [WORKTREE_ID]: MIRRORED_TAB_ID },
    activeGroupIdByWorktree: {}
  }
}

function stateWithSleepRecord(
  origin: SleepingAgentSessionRecord['origin']
): TerminalOrphanRecoveryState {
  const record: SleepingAgentSessionRecord = {
    paneKey: makePaneKey(MIRRORED_TAB_ID, LEAF_ID),
    tabId: MIRRORED_TAB_ID,
    worktreeId: WORKTREE_ID,
    agent: 'pi',
    providerSession: { key: 'session_id', id: 'session-1' },
    prompt: '',
    state: 'done',
    capturedAt: 1,
    updatedAt: 1,
    ...(origin ? { origin } : {})
  }
  return {
    ...stateWithVerifiedBinding(),
    sleepingAgentSessionsByPaneKey: { [record.paneKey]: record }
  }
}

function pendingSnapshot() {
  return {
    worktree: WORKTREE_ID,
    publicationEpoch: 'runtime-restart',
    snapshotVersion: 2,
    activeGroupId: null,
    activeTabId: `${HOST_TAB_ID}::${LEAF_ID}`,
    activeTabType: 'terminal' as const,
    tabs: [
      {
        type: 'terminal' as const,
        id: `${HOST_TAB_ID}::${LEAF_ID}`,
        parentTabId: HOST_TAB_ID,
        leafId: LEAF_ID,
        title: 'Codex',
        ptyId: 'pty-live',
        isActive: true,
        status: 'pending-handle' as const,
        terminal: null
      }
    ]
  }
}

function listCall(terminals: RuntimeTerminalSummary[]): TerminalOrphanRecoveryCall {
  const result: RuntimeTerminalListResult = {
    terminals,
    totalCount: terminals.length,
    truncated: false,
    hostScope: { hostIds: ['local'], omittedHostIds: [] }
  }
  return vi.fn(async () => ({
    id: 'test',
    ok: true as const,
    result,
    _meta: { runtimeId: 'test' }
  }))
}

const goneInventory = (): TerminalOrphanRecoveryCall => listCall([])

const liveInventory = (): TerminalOrphanRecoveryCall =>
  listCall([
    {
      handle: TERMINAL_HANDLE,
      ptyId: 'pty-live',
      incarnationId: 'inc-live',
      orphaned: false,
      worktreeId: WORKTREE_ID,
      worktreePath: '/worktree',
      branch: 'main',
      tabId: HOST_TAB_ID,
      leafId: LEAF_ID,
      title: 'Codex',
      connected: true,
      writable: true,
      lastOutputAt: null,
      preview: ''
    }
  ])

describe('web session pending terminal handle recovery for slept panes', () => {
  beforeEach(() => clearWebSessionTerminalOrphanRecoveryForTests())
  afterEach(() => {
    clearWorktreeSleepIntent(WORKTREE_ID)
    vi.unstubAllGlobals()
  })

  it('keeps a slept pane pending and spends no recovery RPC on its dead handle', async () => {
    // Sleep keeps the layout binding as a wake hint and stops the PTY on the host, so the next
    // host frame is exactly this shape. Recovery used to republish that dead handle as ready,
    // which put it back in the mirror's live map and read the workspace awake (#30108).
    markWorktreeSleepIntent(WORKTREE_ID)
    const call = goneInventory()

    const recovered = await recoverWebSessionTerminalOrphansBeforeApply(
      stateWithVerifiedBinding(),
      pendingSnapshot(),
      ENVIRONMENT_ID,
      { call }
    )

    expect(recovered?.tabs).toMatchObject([
      expect.objectContaining({ status: 'pending-handle', terminal: null })
    ])
    expect(call).not.toHaveBeenCalled()
  })

  it('keeps a pane with a worktree-sleep record pending when the marker is gone', async () => {
    // The in-session marker does not survive a client reload; the persisted record does, and it
    // is the only evidence left that this pane was put away rather than dropped by the host.
    const call = goneInventory()

    const recovered = await recoverWebSessionTerminalOrphansBeforeApply(
      stateWithSleepRecord('worktree-sleep'),
      pendingSnapshot(),
      ENVIRONMENT_ID,
      { call }
    )

    expect(recovered?.tabs).toMatchObject([
      expect.objectContaining({ status: 'pending-handle', terminal: null })
    ])
    expect(call).not.toHaveBeenCalled()
  })

  it.each(['quit', 'live'] as const)(
    'still recovers a pane whose record is a %s capture',
    async (origin) => {
      // Those captures describe a pane that was still running when it was taken down, so the
      // retained handle is a live orphan to rebind, not a wake hint to leave cold.
      const recovered = await recoverWebSessionTerminalOrphansBeforeApply(
        stateWithSleepRecord(origin),
        pendingSnapshot(),
        ENVIRONMENT_ID,
        { call: liveInventory() }
      )

      expect(recovered?.tabs).toMatchObject([
        expect.objectContaining({ status: 'ready', terminal: TERMINAL_HANDLE })
      ])
    }
  )

  it('publishes a ready wake for a slept pane the host now serves again', async () => {
    // The host row is already ready, so recovery never sees a candidate: the sleep guard only
    // stops recovery from inventing liveness, it must not stop a real wake.
    markWorktreeSleepIntent(WORKTREE_ID)
    const snapshot = {
      ...pendingSnapshot(),
      snapshotVersion: 3,
      tabs: [{ ...pendingSnapshot().tabs[0]!, status: 'ready' as const, terminal: TERMINAL_HANDLE }]
    }

    const recovered = await recoverWebSessionTerminalOrphansBeforeApply(
      stateWithVerifiedBinding(),
      snapshot,
      ENVIRONMENT_ID,
      { call: goneInventory() }
    )

    expect(recovered?.tabs).toMatchObject([
      expect.objectContaining({ status: 'ready', terminal: TERMINAL_HANDLE })
    ])
  })
})
