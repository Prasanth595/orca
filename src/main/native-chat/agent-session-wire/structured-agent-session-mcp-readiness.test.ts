import { describe, expect, it, vi } from 'vitest'
import { readStructuredAdapterMcpStatus } from './structured-agent-session-mcp-readiness'

describe('structured adapter MCP readiness', () => {
  it('classifies an adapter without a live MCP status reader as unverifiable', async () => {
    await expect(readStructuredAdapterMcpStatus({}, 'session-1')).resolves.toEqual({
      state: 'unverifiable',
      servers: []
    })
  })

  it('uses the effective provider observation when the adapter exposes one', async () => {
    const readMcpStatus = vi.fn(async () => ({
      state: 'verified' as const,
      servers: [
        {
          name: 'linear',
          state: 'connected' as const,
          capabilities: ['read' as const],
          capabilitiesVerified: true
        }
      ]
    }))

    await expect(
      readStructuredAdapterMcpStatus({ readMcpStatus }, 'session-1')
    ).resolves.toMatchObject({ state: 'verified', servers: [{ name: 'linear' }] })
    expect(readMcpStatus).toHaveBeenCalledWith('session-1')
  })
})
