import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { AgentJournalItemBody } from '../../../shared/agent-session-journal-types'
import { journalPragmaNumber } from './journal-database'
import {
  closeTestJournalHostDatabases,
  openTestJournalHostDatabase
} from './journal-host-database-test-support'
import { applyJournalRow, createJournalReducerState } from './journal-reducer'
import type { JournalItemRow } from './journal-row-schema'
import { isJournalStreamedTextRevision } from './journal-streamed-text-revision'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-streamed-revision-'))
})
afterEach(async () => {
  closeTestJournalHostDatabases()
  await rm(root, { recursive: true, force: true })
})

const text = (role: 'assistant' | 'user', value: string): AgentJournalItemBody => ({
  kind: 'message',
  role,
  blocks: [{ type: 'text', text: value }]
})

function item(seq: number, itemId: string, revision: number, body: AgentJournalItemBody): JournalItemRow {
  return { v: 1, epoch: 'epoch', seq, fence: 1, ts: seq, kind: 'item', itemId, revision, body }
}

it('skips the per-commit fsync only for a later revision of assistant text', () => {
  const state = createJournalReducerState('chat', 'epoch')
  const first = item(1, 'reply', 1, text('assistant', 'Hel'))
  expect(isJournalStreamedTextRevision(state, first)).toBe(false)
  applyJournalRow(state, first)
  expect(isJournalStreamedTextRevision(state, item(2, 'reply', 2, text('assistant', 'Hello')))).toBe(
    true
  )
  // Ownership or turn changes ride the row, so they keep FULL.
  expect(
    isJournalStreamedTextRevision(state, { ...item(2, 'reply', 2, text('assistant', 'x')), ownerFence: 9 })
  ).toBe(false)
  expect(
    isJournalStreamedTextRevision(state, { ...item(2, 'reply', 2, text('assistant', 'x')), agentId: 'child' })
  ).toBe(false)
  // A user echo withdraws queued drafts; a tool call can end a turn.
  const echo = item(3, 'echo', 1, text('user', 'hi'))
  applyJournalRow(state, echo)
  expect(isJournalStreamedTextRevision(state, item(4, 'echo', 2, text('user', 'hi!')))).toBe(false)
  const tool: AgentJournalItemBody = {
    kind: 'tool-call',
    name: 'Read',
    input: null,
    state: 'running'
  }
  applyJournalRow(state, item(5, 'tool', 1, tool))
  expect(isJournalStreamedTextRevision(state, item(6, 'tool', 2, tool))).toBe(false)
})

it('commits a streamed transaction at NORMAL and returns the connection to FULL', () => {
  const database = openTestJournalHostDatabase(root)
  const levels: number[] = []
  database.transaction((db) => levels.push(journalPragmaNumber(db, 'synchronous')), true)
  levels.push(journalPragmaNumber(database.db, 'synchronous'))
  database.transaction((db) => levels.push(journalPragmaNumber(db, 'synchronous')))
  expect(() =>
    database.transaction(() => {
      throw new Error('rolled back')
    }, true)
  ).toThrow('rolled back')
  levels.push(journalPragmaNumber(database.db, 'synchronous'))
  expect(levels).toEqual([1, 2, 2, 2])
})
