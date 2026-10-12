import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createCursorSessionResumeState,
  parseCursorSessionContent,
  parseCursorSessionFile
} from './session-scanner-cursor-parser'

const file = {
  path: '/home/test/.cursor/projects/project/agent-transcripts/chat/chat.jsonl',
  mtimeMs: 1,
  modifiedAt: new Date(1).toISOString()
}
const timestamp = '<timestamp>Sunday, Oct 11, 2026, 4:30 PM (UTC+1)</timestamp>'
const prompt = 'Fix the login bug'
const envelope = `${timestamp}\n<user_query>\n${prompt}\n</user_query>`
const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Cursor session titles', () => {
  it.each([
    { message: { content: envelope } },
    { message: { content: [{ type: 'text', text: envelope }] } },
    { content: envelope }
  ])('uses the ask inside a Cursor query envelope: %j', async (content) => {
    const session = await parseCursorSessionContent(
      file,
      JSON.stringify({ role: 'user', ...content }),
      'linux'
    )
    expect(session?.title).toBe(prompt)
  })

  it('unwraps split text blocks before applying the title length limit', async () => {
    const ask = 'Review the deployment configuration. '.repeat(4)
    const content = [
      { type: 'text', text: `<user_info>${'workspace context '.repeat(30)}</user_info>` },
      { type: 'text', text: `${timestamp}\n<user_query>\n${ask}\n</user_query>` }
    ]
    const session = await parseCursorSessionContent(
      file,
      JSON.stringify({ role: 'user', message: { content } }),
      'linux'
    )
    expect(session?.title).toBe(`${ask.slice(0, 93)}...`)
  })

  it('keeps the first plain prompt when more turns arrive', async () => {
    const state = createCursorSessionResumeState(file)
    state.consumeLine(JSON.stringify({ role: 'user', message: { content: prompt } }))
    state.consumeLine(JSON.stringify({ role: 'assistant', message: { content: 'Done' } }))
    state.consumeLine(
      JSON.stringify({
        role: 'user',
        message: { content: '<user_query>Add a logout button</user_query>' }
      })
    )
    expect(await state.finalize('linux')).toMatchObject({ title: prompt, messageCount: 3 })
  })

  it.each([
    { message: { content: `<system-reminder>Context</system-reminder>${prompt}` } },
    { message: { content: '<goal_context>Context</goal_context>' }, content: prompt }
  ])('preserves existing hidden-context and content fallback handling: %j', async (content) => {
    const session = await parseCursorSessionContent(
      file,
      JSON.stringify({ role: 'user', ...content }),
      'linux'
    )
    expect(session?.title).toBe(prompt)
  })

  it('lets a later ask name a session whose opening query is empty', async () => {
    const state = createCursorSessionResumeState(file)
    state.consumeLine(
      JSON.stringify({ role: 'user', content: `${timestamp}<user_query> </user_query>` })
    )
    state.consumeLine(JSON.stringify({ role: 'user', content: envelope }))
    expect((await state.finalize('linux'))?.title).toBe(prompt)
  })

  it('normalizes the ask while preserving transcript previews', async () => {
    const content = '<user_query>修复登录\n\t并保留 😀 提示</user_query>'
    const session = await parseCursorSessionContent(
      file,
      JSON.stringify({ role: 'user', message: { content } }),
      'linux'
    )
    expect(session?.title).toBe('修复登录 并保留 😀 提示')
    expect(session?.previewMessages[0]?.text).toContain('<user_query>')
  })

  it('uses the same title for streamed remote records without changing their host', async () => {
    async function* records(): AsyncGenerator<string> {
      yield JSON.stringify({ role: 'user', message: { content: envelope } })
      yield JSON.stringify({ role: 'assistant', message: { content: 'Done' } })
    }
    const session = await parseCursorSessionContent(file, records(), 'win32', {
      executionHostId: 'ssh:test-host',
      executionHostPlatform: 'linux'
    })
    expect(session).toMatchObject({
      title: prompt,
      executionHostId: 'ssh:test-host',
      executionHostPlatform: 'linux',
      messageCount: 2
    })
  })

  it('reads the unwrapped title from a local transcript file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-cursor-title-'))
    tempRoots.push(root)
    const localFile = { ...file, path: join(root, 'chat.jsonl') }
    await writeFile(
      localFile.path,
      `${JSON.stringify({ role: 'user', message: { content: envelope } })}\n`
    )
    expect((await parseCursorSessionFile(localFile))?.title).toBe(prompt)
  })
})
