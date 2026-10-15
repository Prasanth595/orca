import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const callMock = vi.hoisted(() => vi.fn())
vi.mock('../runtime-client', async () => {
  class RuntimeClient {
    readonly isRemote = false
    call = callMock
    getCliStatus = vi.fn()
    openOrca = vi.fn()
  }
  const { RuntimeClientError, RuntimeRpcFailureError } = await import('../runtime/types.js')
  return { RuntimeClient, RuntimeClientError, RuntimeRpcFailureError }
})
import { main } from '../index'
import { okFixture, queueFixtures } from '../test-fixtures'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const id = '22222222-2222-4222-8222-222222222222'
const originalEnv = { ...process.env }
beforeEach(() => {
  vi.restoreAllMocks()
  callMock.mockReset()
  process.env = { ...originalEnv }
  delete process.env.ORCA_TERMINAL_HANDLE
  delete process.env.ORCA_WORKTREE_ID
  delete process.env.ORCA_PAIRING_CODE
  delete process.env.ORCA_ENVIRONMENT
  process.exitCode = undefined
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  process.env = { ...originalEnv }
  process.exitCode = undefined
})

describe('Public Linear content CLI', () => {
  it('routes parsed project full reads to the new read RPC', async () => {
    queueFixtures(
      callMock,
      okFixture('project-read', {
        project: { id, content: 'Full body' },
        documents: [],
        meta: { partial: false }
      })
    )
    await main(
      ['linear', 'project', 'get', id, '--workspace', workspaceId, '--full', '--json'],
      '/isolated'
    )
    expect(callMock).toHaveBeenCalledWith(
      'linear.agentProjectRead',
      { id, workspaceId, full: true },
      { timeoutMs: 120_000 }
    )
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Full body'))
  })
  it('routes document slugs to the read RPC', async () => {
    queueFixtures(
      callMock,
      okFixture('document-read', {
        document: { content: 'Full document' },
        meta: { contentComplete: true }
      })
    )
    await main(
      ['linear', 'document', 'get', 'design-slug', '--workspace', workspaceId, '--json'],
      '/isolated'
    )
    expect(callMock).toHaveBeenCalledWith(
      'linear.agentDocumentRead',
      { id: 'design-slug', workspaceId },
      { timeoutMs: 45_000 }
    )
  })
  it.each([
    { flags: [] },
    { flags: ['--workspace', 'all'] },
    { flags: ['--workspace', 'Example'] }
  ])('rejects missing or ambiguous workspace %j', async ({ flags }) => {
    await main(['linear', 'project', 'get', id, ...flags, '--json'], '/isolated')
    expect(callMock).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })
  it('rejects unknown flags before RPC access', async () => {
    await main(['linear', 'document', 'get', id, '--workspace', workspaceId, '--full'], '/isolated')
    expect(callMock).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })
  it.each([
    ['project', 'get'],
    ['document', 'get']
  ])('publishes help for %s %s without runtime access', async (noun, verb) => {
    await main(['linear', noun, verb, '--help'], '/isolated')
    expect(callMock).not.toHaveBeenCalled()
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining(`linear ${noun} ${verb}`))
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('--workspace'))
  })
  it('publishes both commands in the public schema', async () => {
    await main(['agent-context', '--json'], '/isolated')
    expect(callMock).not.toHaveBeenCalled()
    const output = vi
      .mocked(console.log)
      .mock.calls.map(([line]) => String(line))
      .join('\n')
    expect(output).toContain('linear project get')
    expect(output).toContain('linear document get')
  })
})
