import { beforeEach, describe, expect, it, vi } from 'vitest'

const { callMock, runtimeClientConstructorMock, serveOrcaAppMock, getDefaultUserDataPathMock } =
  vi.hoisted(() => ({
    callMock: vi.fn(),
    runtimeClientConstructorMock: vi.fn(),
    serveOrcaAppMock: vi.fn(),
    getDefaultUserDataPathMock: vi.fn(() => '/tmp/orca-user-data')
  }))

vi.mock('./runtime-client', async () => {
  const { createRuntimeClientModuleMock } = await import('./index-test-harness.js')
  return createRuntimeClientModuleMock({
    callMock,
    runtimeClientConstructorMock,
    serveOrcaAppMock,
    getDefaultUserDataPathMock
  })
})

import { main } from './index'
import { okFixture, queueFixtures } from './test-fixtures'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('orca agent mcp-readiness', () => {
  it('prints the host readiness projection as JSON', async () => {
    queueFixtures(
      callMock,
      okFixture('req_mcp_readiness', {
        state: 'blocked',
        requirements: [
          {
            serverNames: ['linear'],
            capability: 'write',
            state: 'needs-auth',
            satisfiedBy: 'linear'
          }
        ],
        servers: [
          {
            name: 'linear',
            state: 'needs-auth',
            capabilities: [],
            capabilitiesVerified: false
          }
        ]
      })
    )
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(['agent', 'mcp-readiness', '--session', 'claude_12345678', '--json'], '/tmp')

    expect(callMock).toHaveBeenCalledWith('agentSession.mcpReadiness', {
      sessionId: 'claude_12345678'
    })
    expect(JSON.parse(String(log.mock.calls[0]?.[0])).result).toMatchObject({
      state: 'blocked',
      requirements: [{ state: 'needs-auth' }]
    })
  })

  it('resolves an explicit worktree before selecting its agent session', async () => {
    queueFixtures(
      callMock,
      okFixture('req_worktree', { worktree: { id: 'repo::/srv/project' } }),
      okFixture('req_mcp_readiness', {
        state: 'unverifiable',
        requirements: [],
        servers: []
      })
    )
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(
      [
        'agent',
        'mcp-readiness',
        '--worktree',
        'id:repo::/srv/project',
        '--agent',
        'codex',
        '--json'
      ],
      '/tmp/client-project'
    )

    expect(callMock).toHaveBeenNthCalledWith(1, 'worktree.show', {
      worktree: 'id:repo::/srv/project'
    })
    expect(callMock).toHaveBeenNthCalledWith(2, 'agentSession.mcpReadiness', {
      workspaceId: 'repo::/srv/project',
      agent: 'codex'
    })
    expect(JSON.parse(String(log.mock.calls[0]?.[0])).result.state).toBe('unverifiable')
  })
})
