import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionJournalIdentity } from '../../shared/agent-session-journal-types'
import { openAgentSessionJournal } from '../native-chat/agent-session-journal/journal-store-factory'
import { createDeferredStructuredAgentSessionEventSink } from '../native-chat/agent-session-wire/structured-agent-session-event-sink'
import { createClaudeJournalTranslator } from './claude-structured-journal-translation'
import { openTestJournalHostDatabase } from '../native-chat/agent-session-journal/journal-host-database-test-support'
import { testEventSinkLogging } from '../native-chat/agent-session-wire/structured-agent-session-logger-test-support'
import { claudeProviderHandle } from '../../shared/agent-session-provider-handle-encoding'

const IDENTITY: AgentSessionJournalIdentity = {
  sessionId: 'session-1',
  workspaceId: 'workspace-1',
  hostId: 'host-1',
  agent: 'claude',
  providerHandle: claudeProviderHandle('provider-1', 'leaf-1')
}

/** An init frame as Claude Code 2.1.299 sends it, trimmed to the fields this row reads. */
function init(servers: { name: string; status: string }[], n: number): Record<string, unknown> {
  return {
    type: 'system',
    subtype: 'init',
    mcp_servers: servers,
    uuid: `5d3c1f0e-7a2b-4c6d-9e8f-00000000000${n}`,
    session_id: 'provider-1'
  }
}

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-claude-mcp-connect-failure-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function itemsFor(frames: Record<string, unknown>[]) {
  const journal = await openAgentSessionJournal({
    identity: IDENTITY,
    database: openTestJournalHostDatabase(root),
    now: () => 1_700_000_000_000,
    mintEpoch: () => 'epoch-1'
  })
  const deferred = createDeferredStructuredAgentSessionEventSink(testEventSinkLogging())
  deferred.bind({ journal, fence: 1, publish: vi.fn() })
  const translator = createClaudeJournalTranslator({ sink: deferred.sink, fallbackIdPrefix: '1' })
  for (const frame of frames) {
    translator.handle({ type: 'message', sessionId: 'orca-session', message: frame })
    await deferred.drained()
  }
  return journal.snapshot().items.map((item) => item.body)
}

describe('a Claude init frame', () => {
  it('writes no row when every MCP server connected or only needs auth', async () => {
    const servers = [
      { name: 'playwright', status: 'connected' },
      { name: 'linear', status: 'needs-auth' }
    ]
    expect(await itemsFor([init(servers, 1)])).toEqual([])
  })

  it('names each newly failed MCP server once, however often init repeats', async () => {
    const items = await itemsFor([
      init([{ name: 'marimo', status: 'failed' }], 1),
      init([{ name: 'marimo', status: 'failed' }], 2),
      init(
        [
          { name: 'marimo', status: 'failed' },
          { name: 'braintrust', status: 'failed' }
        ],
        3
      )
    ])

    expect(items).toEqual([
      {
        kind: 'status',
        tone: 'warning',
        text: 'MCP server "marimo" failed to connect, so its tools are unavailable in this session. Run `claude mcp list` in a terminal to see why.'
      },
      {
        kind: 'status',
        tone: 'warning',
        text: 'MCP server "braintrust" failed to connect, so its tools are unavailable in this session. Run `claude mcp list` in a terminal to see why.'
      }
    ])
  })

  it('names every server that failed in one init in one row', async () => {
    const items = await itemsFor([
      init(
        [
          { name: 'marimo', status: 'failed' },
          { name: 'braintrust', status: 'failed' }
        ],
        1
      )
    ])

    expect(items).toEqual([
      {
        kind: 'status',
        tone: 'warning',
        text: 'MCP servers "marimo", "braintrust" failed to connect, so their tools are unavailable in this session. Run `claude mcp list` in a terminal to see why.'
      }
    ])
  })
})
