import { describe, expect, it } from 'vitest'
import { isStructuredHumanReply } from './structured-reply-origin'
import { replySnapshotFixture } from './structured-reply-origin.test-fixture'

describe('S8: host journal source and exact completed chat turn', () => {
  it.each([false, true])('accepts a user send, including merged/steered input: %s', (steered) => {
    expect(isStructuredHumanReply(replySnapshotFixture('user', steered), 'turn-A')).toBe(true)
  })
  it.each(['agent', undefined] as const)('rejects wake and unknown send sources: %s', (source) => {
    expect(isStructuredHumanReply(replySnapshotFixture(source), 'turn-A')).toBe(false)
  })
  it('rejects an old human completion after a later program turn has already completed', () => {
    const data = replySnapshotFixture('user')
    data.items.push({
      itemId: 'later-turn',
      revision: 1,
      sequence: 4,
      observedAt: 2,
      body: { kind: 'turn', turnId: 'turn-B', state: 'completed' }
    })
    expect(isStructuredHumanReply(data, 'turn-A')).toBe(false)
  })
  it('does not reveal a completion from before the provider context was cleared', () => {
    const data = replySnapshotFixture('user')
    data.items.push({
      itemId: 'clear-boundary',
      revision: 1,
      sequence: 4,
      observedAt: 2,
      body: {
        kind: 'status',
        text: 'invented clear',
        contextClear: { operationId: 'clear', afterFence: 1, clearedAt: 2 }
      }
    })
    expect(isStructuredHumanReply(data, 'turn-A')).toBe(false)
  })
  it('does not borrow an unrelated human send, a child, or an old recovered submission', () => {
    const data = replySnapshotFixture('user')
    expect(isStructuredHumanReply(data, 'turn-B')).toBe(false)
    data.items[0]!.agentId = 'child'
    expect(isStructuredHumanReply(data, 'turn-A')).toBe(false)
    delete data.items[0]!.agentId
    data.submissions[0]!.recovered = true
    expect(isStructuredHumanReply(data, 'turn-A')).toBe(false)
  })
})
