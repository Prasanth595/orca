import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { resolveSessionFilePath } from './session-file-resolver'
import { readNativeChatTranscript } from './transcript-reader'

const SESSION_ID = '20261012_184921_90f68d'

let tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })))
  tempRoots = []
})

async function writeTranscript(lines: unknown[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'hermes-sessions-'))
  tempRoots.push(root)
  await writeFile(
    join(root, `session_${SESSION_ID}.jsonl`),
    `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`,
    'utf-8'
  )
  return root
}

describe('hermes native chat transcript', () => {
  it('resolves the exported JSONL by session id and decodes every turn', async () => {
    const root = await writeTranscript([
      { type: 'session', sessionId: SESSION_ID, cwd: '/work', model: 'free/cb/deepseek-v4.1-flash' },
      { type: 'message', id: 'm1', role: 'user', text: 'hello' },
      { type: 'tool', id: 't1', name: 'terminal', output: 'ok' },
      { type: 'message', id: 'm2', role: 'assistant', text: 'hi' }
    ])

    await expect(
      resolveSessionFilePath('hermes', SESSION_ID, { hermesSessionsDir: root })
    ).resolves.toBe(join(root, `session_${SESSION_ID}.jsonl`))

    const result = await readNativeChatTranscript('hermes', SESSION_ID, { hermesSessionsDir: root })
    if (!('messages' in result)) {
      throw new Error(`expected messages, got ${result.error}`)
    }
    expect(result.messages.map((message) => message.role)).toEqual(['user', 'tool', 'assistant'])
    expect(result.messages[2]?.blocks).toEqual([{ type: 'text', text: 'hi' }])
  })

  it('reports a miss when the session was never exported', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hermes-sessions-'))
    tempRoots.push(root)

    const result = await readNativeChatTranscript('hermes', SESSION_ID, { hermesSessionsDir: root })
    expect('error' in result && result.notFound).toBe(true)
  })

  // `hermes sessions export` names its file differently and nests the turns in one row per session.
  it('reads the documented export file, one session row with its turns nested', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hermes-sessions-'))
    tempRoots.push(root)
    const file = join(root, `hermes_session_${SESSION_ID}.jsonl`)
    await writeFile(
      file,
      `${JSON.stringify({
        sessionId: SESSION_ID,
        cwd: '/work',
        messages: [
          { type: 'message', id: 'n1', role: 'user', text: 'nested hello' },
          { type: 'message', id: 'n2', role: 'assistant', text: 'nested hi' }
        ]
      })}\n`,
      'utf-8'
    )

    await expect(
      resolveSessionFilePath('hermes', SESSION_ID, { hermesSessionsDir: root })
    ).resolves.toBe(file)

    const result = await readNativeChatTranscript('hermes', SESSION_ID, { hermesSessionsDir: root })
    if (!('messages' in result)) {
      throw new Error(`expected messages, got ${result.error}`)
    }
    expect(result.messages.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(result.messages[1]?.blocks).toEqual([{ type: 'text', text: 'nested hi' }])
  })
})
