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
