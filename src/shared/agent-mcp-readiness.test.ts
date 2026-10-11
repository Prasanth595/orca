import { describe, expect, it } from 'vitest'
import { evaluateAgentMcpReadiness, normalizeProjectMcpRequirements } from './agent-mcp-readiness'
import type { ProjectMcpRequirement } from './agent-mcp-readiness'

describe('evaluateAgentMcpReadiness', () => {
  it('blocks a write requirement when Linear needs authentication', () => {
    expect(
      evaluateAgentMcpReadiness([{ serverNames: ['linear'], capability: 'write' }], {
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
    ).toMatchObject({
      state: 'blocked',
      requirements: [{ state: 'needs-auth', satisfiedBy: 'linear' }]
    })
  })

  it('accepts a connected alternative only when that server proves the capability', () => {
    const requirement: ProjectMcpRequirement = {
      serverNames: ['linear', 'linear-cloud'],
      capability: 'write'
    }
    expect(
      evaluateAgentMcpReadiness([requirement], {
        state: 'verified',
        servers: [
          {
            name: 'linear',
            state: 'failed',
            capabilities: [],
            capabilitiesVerified: false
          },
          {
            name: 'linear-cloud',
            state: 'connected',
            capabilities: ['write'],
            capabilitiesVerified: true
          }
        ]
      })
    ).toMatchObject({ state: 'ready', requirements: [{ satisfiedBy: 'linear-cloud' }] })

    expect(
      evaluateAgentMcpReadiness([requirement], {
        state: 'verified',
        servers: [
          {
            name: 'linear-cloud',
            state: 'connected',
            capabilities: ['read'],
            capabilitiesVerified: true
          }
        ]
      })
    ).toMatchObject({ state: 'blocked', requirements: [{ state: 'unavailable' }] })
  })

  it('does not collapse missing capability evidence into unavailable', () => {
    expect(
      evaluateAgentMcpReadiness([{ serverNames: ['linear'], capability: 'write' }], {
        state: 'verified',
        servers: [
          {
            name: 'linear',
            state: 'connected',
            capabilities: [],
            capabilitiesVerified: false
          }
        ]
      })
    ).toMatchObject({ state: 'unverifiable', requirements: [{ state: 'unverifiable' }] })
  })

  it('keeps an unverified connected alternative ahead of another server failure', () => {
    expect(
      evaluateAgentMcpReadiness(
        [{ serverNames: ['linear', 'linear-cloud'], capability: 'write' }],
        {
          state: 'verified',
          servers: [
            {
              name: 'linear',
              state: 'needs-auth',
              capabilities: [],
              capabilitiesVerified: false
            },
            {
              name: 'linear-cloud',
              state: 'connected',
              capabilities: [],
              capabilitiesVerified: false
            }
          ]
        }
      )
    ).toMatchObject({ state: 'unverifiable', requirements: [{ state: 'unverifiable' }] })
  })
})

describe('normalizeProjectMcpRequirements', () => {
  it('drops malformed rows without retaining extra fields', () => {
    expect(
      normalizeProjectMcpRequirements([
        { serverNames: [' linear ', ''], capability: 'write', token: 'never-retain' },
        { serverNames: [], capability: 'read' },
        { serverNames: ['x'], capability: 'admin' }
      ])
    ).toEqual([{ serverNames: ['linear'], capability: 'write' }])
  })
})
