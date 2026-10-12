import { describe, expect, it } from 'vitest'
import {
  createCodexMcpReadinessTracker,
  observeCodexMcpServerStatus,
  projectCodexMcpReadiness
} from './codex-mcp-readiness'

describe('Codex MCP readiness', () => {
  it('projects startup states without retaining provider diagnostics', () => {
    const tracker = createCodexMcpReadinessTracker()
    observeCodexMcpServerStatus(tracker, 'mcpServer/startupStatus/updated', {
      threadId: 'thread-secret',
      serverName: 'linear',
      status: 'failed',
      failureReason: 'reauthenticationRequired',
      error: 'token=never-retain'
    })

    expect(projectCodexMcpReadiness(tracker)).toEqual({
      state: 'verified',
      servers: [
        {
          name: 'linear',
          state: 'needs-auth',
          capabilities: [],
          capabilitiesVerified: false
        }
      ]
    })
  })

  it.each(['name', 'server'] as const)('accepts the legacy %s server field', (field) => {
    const tracker = createCodexMcpReadinessTracker()
    observeCodexMcpServerStatus(tracker, 'mcpServer/startupStatus/updated', {
      [field]: 'linear',
      status: 'ready'
    })

    expect(projectCodexMcpReadiness(tracker)).toMatchObject({
      servers: [{ name: 'linear', state: 'connected' }]
    })
  })

  it.each([
    ['starting', 'pending'],
    ['ready', 'connected'],
    ['failed', 'failed'],
    ['cancelled', 'unavailable']
  ] as const)('maps %s to %s', (status, state) => {
    const tracker = createCodexMcpReadinessTracker()
    observeCodexMcpServerStatus(tracker, 'mcpServer/startupStatus/updated', {
      server: 'linear',
      status
    })

    expect(projectCodexMcpReadiness(tracker)).toMatchObject({
      servers: [{ name: 'linear', state }]
    })
  })

  it('is unverifiable until a recognized live status is observed', () => {
    const tracker = createCodexMcpReadinessTracker()
    observeCodexMcpServerStatus(tracker, 'unrelated', {
      name: 'linear',
      status: 'ready'
    })

    expect(projectCodexMcpReadiness(tracker)).toEqual({ state: 'unverifiable', servers: [] })
  })
})
