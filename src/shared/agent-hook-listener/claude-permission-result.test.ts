import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readClaudePermissionResult } from './claude-permission-result'

const identity = { sessionId: 'session-1', toolUseId: 'tool-1' }
const call = {
  sessionId: 'session-1',
  uuid: 'call',
  parentUuid: null,
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tool-1', name: 'Bash' }] }
}
const result = {
  sessionId: 'session-1',
  uuid: 'result',
  parentUuid: 'call',
  type: 'user',
  message: {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: 'tool-1', is_error: true, content: 'denied' }]
  }
}

describe('Claude permission result evidence', () => {
  const dirs: string[] = []
  function transcript(rows: unknown[], suffix = '\n'): string {
    const dir = mkdtempSync(join(tmpdir(), 'claude-permission-result-'))
    dirs.push(dir)
    const path = join(dir, 'session.jsonl')
    writeFileSync(path, rows.map((row) => JSON.stringify(row)).join('\n') + suffix)
    return path
  }
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it.each([true, false])('recognizes a terminal result with is_error=%s', (isError) => {
    const path = transcript([
      call,
      {
        ...result,
        message: {
          ...result.message,
          content: [{ ...result.message.content[0], is_error: isError }]
        }
      }
    ])
    expect(readClaudePermissionResult(path, identity)).toBe(true)
  })

  it('requires the requested call, not merely error text or an orphan result', () => {
    expect(readClaudePermissionResult(transcript([result]), identity)).toBe(false)
    expect(readClaudePermissionResult(transcript([call]), identity)).toBe(false)
    expect(
      readClaudePermissionResult(
        transcript([call, { ...result, message: { role: 'user', content: 'tool-1 denied' } }]),
        identity
      )
    ).toBe(false)
  })

  it('rejects another request, session, or child owner', () => {
    const path = transcript([call, result])
    expect(readClaudePermissionResult(path, { ...identity, toolUseId: 'tool-2' })).toBe(false)
    expect(readClaudePermissionResult(path, { ...identity, sessionId: 'session-2' })).toBe(false)
    expect(readClaudePermissionResult(path, { ...identity, agentId: 'child-1' })).toBe(false)
    const childPath = transcript(
      [call, result].map((row) => ({ ...row, agentId: 'child-1', isSidechain: true }))
    )
    expect(readClaudePermissionResult(childPath, identity)).toBe(false)
    expect(readClaudePermissionResult(childPath, { ...identity, agentId: 'child-1' })).toBe(true)
  })

  it('ignores a result on an abandoned sibling branch', () => {
    const path = transcript([
      call,
      result,
      { ...call, uuid: 'new-tip', parentUuid: 'call', message: { role: 'assistant', content: [] } }
    ])
    expect(readClaudePermissionResult(path, identity)).toBe(false)
  })

  it('requires every matching parallel call to settle when the permission id was inferred', () => {
    const parallelCall = {
      ...call,
      message: {
        role: 'assistant',
        content: [...call.message.content, { type: 'tool_use', id: 'tool-2', name: 'Bash' }]
      }
    }
    const inferred = { ...identity, inferredTool: { name: 'Bash' } }
    const path = transcript([parallelCall, result])
    expect(readClaudePermissionResult(path, identity)).toBe(true)
    expect(readClaudePermissionResult(path, inferred)).toBe(false)
    writeFileSync(
      path,
      `${[
        parallelCall,
        {
          ...result,
          message: {
            ...result.message,
            content: [...result.message.content, { type: 'tool_result', tool_use_id: 'tool-2' }]
          }
        }
      ]
        .map((row) => JSON.stringify(row))
        .join('\n')}\n`
    )
    expect(readClaudePermissionResult(path, inferred)).toBe(true)
  })

  it('rejects broken ancestry and result-before-call ordering', () => {
    expect(
      readClaudePermissionResult(transcript([call, { ...result, parentUuid: 'missing' }]), identity)
    ).toBe(false)
    expect(readClaudePermissionResult(transcript([result, call]), identity)).toBe(false)
  })

  it('does not wait for a different tool or an earlier prompt when correlating an inferred id', () => {
    const prompt = {
      sessionId: 'session-1',
      uuid: 'prompt',
      parentUuid: 'old-call',
      type: 'user',
      message: { role: 'user', content: 'new task' }
    }
    const current = {
      ...call,
      parentUuid: 'prompt',
      message: {
        role: 'assistant',
        content: [...call.message.content, { type: 'tool_use', id: 'other-tool', name: 'Read' }]
      }
    }
    const path = transcript([{ ...call, uuid: 'old-call' }, prompt, current, result])
    expect(readClaudePermissionResult(path, { ...identity, inferredTool: { name: 'Bash' } })).toBe(
      true
    )
  })

  it('waits for a complete tail and fails closed on malformed or missing files', () => {
    const path = transcript([call, result], '')
    expect(readClaudePermissionResult(path, identity)).toBe(false)
    writeFileSync(path, '{broken}\n')
    expect(readClaudePermissionResult(path, identity)).toBe(false)
    rmSync(path)
    expect(readClaudePermissionResult(path, identity)).toBe(false)
  })

  it('follows ancestry across scan chunks and stops at the scan budget', () => {
    const padding = { type: 'progress', data: 'x'.repeat(70_000) }
    expect(readClaudePermissionResult(transcript([call, padding, result]), identity)).toBe(true)
    expect(
      readClaudePermissionResult(
        transcript([call, { ...padding, data: 'x'.repeat(4 * 1024 * 1024) }, result]),
        identity
      )
    ).toBe(false)
  })
})
