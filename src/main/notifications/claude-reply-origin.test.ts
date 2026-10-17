import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isClaudeHumanReply } from './claude-reply-origin'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
async function transcript(rows: unknown[]) {
  const dir = await mkdtemp(join(tmpdir(), 'reply-origin-'))
  directories.push(dir)
  const path = join(dir, 'invented.jsonl')
  await writeFile(path, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`)
  return path
}

describe('Claude exact prompt origin', () => {
  it('S10: recovers a human origin across a compact summary and a large tail', async () => {
    const path = await transcript([
      { type: 'user', promptId: 'A', origin: { kind: 'human' } },
      { type: 'assistant', message: { content: 'x'.repeat(150_000) } },
      { type: 'user', promptId: 'A', isCompactSummary: true }
    ])
    expect(await isClaudeHumanReply(path, 'A')).toBe(true)
  })
  it('S4/S11: neither summaries, unrelated people, nor task notifications imply human origin', async () => {
    const path = await transcript([
      { type: 'user', promptId: 'A', origin: { kind: 'human' } },
      { type: 'user', promptId: 'B', origin: { kind: 'task-notification' } },
      { type: 'user', promptId: 'B', isCompactSummary: true }
    ])
    expect(await isClaudeHumanReply(path, 'B')).toBe(false)
    expect(await isClaudeHumanReply(path, 'missing')).toBe(false)
  })
  it('stops at the matching explicit origin and fails closed on cancellation', async () => {
    const path = await transcript([
      { type: 'assistant', message: { content: 'x'.repeat(150_000) } },
      { type: 'user', promptId: 'A', origin: { kind: 'human' } }
    ])
    let bytes = 0
    expect(
      await isClaudeHumanReply(path, 'A', undefined, (read) => {
        bytes += read
      })
    ).toBe(true)
    expect(bytes).toBeLessThan(150_000)
    const controller = new AbortController()
    controller.abort()
    expect(await isClaudeHumanReply(path, 'A', controller.signal)).toBe(false)
  })
})
