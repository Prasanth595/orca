import { describe, expect, it } from 'vitest'
import {
  automationInboxEntryKey,
  changeAutomationInboxEntries,
  countAutomationInboxUnread,
  mergeAutomationInboxEntries,
  normalizeAutomationInboxEntries,
  MAX_AUTOMATION_INBOX_ENTRIES
} from './automation-inbox'
import { makeAutomationInboxEntry } from './automation-inbox-test-fixture'

describe('automation inbox records', () => {
  it('counts a failure without a workspace or agent, and isolates identical run ids by authority', () => {
    const local = makeAutomationInboxEntry()
    const remote = makeAutomationInboxEntry({}, 'host:runtime:env-1:self')
    const records = normalizeAutomationInboxEntries({ local, remote })
    expect(Object.keys(records)).toHaveLength(2)
    expect(countAutomationInboxUnread(records)).toBe(2)
    const read = changeAutomationInboxEntries(records, [automationInboxEntryKey(local)], 'read')
    expect(countAutomationInboxUnread(read)).toBe(1)
    expect(read[automationInboxEntryKey(remote)].read).toBe(false)
  })

  it.each(['read', 'dismiss'] as const)(
    'keeps a %s receipt through restart and repeated catch-up',
    (action) => {
      const entry = makeAutomationInboxEntry()
      const records = normalizeAutomationInboxEntries({ entry })
      const changed = changeAutomationInboxEntries(
        records,
        [automationInboxEntryKey(entry)],
        action
      )
      const restored = normalizeAutomationInboxEntries(JSON.parse(JSON.stringify(changed)))
      const caughtUp = mergeAutomationInboxEntries(restored, records)
      expect(countAutomationInboxUnread(caughtUp)).toBe(0)
      expect(caughtUp).toBe(restored)
      expect(caughtUp[automationInboxEntryKey(entry)].dismissed).toBe(action === 'dismiss')
    }
  )

  it('upgrades attention to failure in one row and ignores delayed attention replays', () => {
    const attention = makeAutomationInboxEntry({
      status: 'needs_attention',
      message: 'Review policy'
    })
    const original = normalizeAutomationInboxEntries({ attention })
    const dismissed = changeAutomationInboxEntries(
      original,
      [automationInboxEntryKey(attention)],
      'dismiss'
    )
    const failure = makeAutomationInboxEntry({ message: 'Agent crashed', createdAt: 11 })
    const upgraded = mergeAutomationInboxEntries(
      dismissed,
      normalizeAutomationInboxEntries({ failure })
    )
    expect(Object.keys(upgraded)).toHaveLength(1)
    expect(countAutomationInboxUnread(upgraded)).toBe(1)
    expect(upgraded[automationInboxEntryKey(failure)].alert.message).toBe('Agent crashed')
    expect(mergeAutomationInboxEntries(upgraded, original)).toBe(upgraded)
  })

  it('bounds retention, drops malformed records, and keeps long failure messages readable', () => {
    const records = Object.fromEntries(
      Array.from({ length: 250 }, (_, index) => [
        `input-${index}`,
        makeAutomationInboxEntry({
          runId: `run-${index}`,
          createdAt: index,
          message: 'x'.repeat(5000)
        })
      ])
    )
    const normalized = normalizeAutomationInboxEntries({
      ...records,
      broken: { catalogKey: 'invalid' }
    })
    expect(Object.keys(normalized)).toHaveLength(MAX_AUTOMATION_INBOX_ENTRIES)
    expect(Object.values(normalized).every((entry) => entry.alert.createdAt >= 50)).toBe(true)
    expect(Object.values(normalized)[0].alert.message).toHaveLength(4000)
  })
})
