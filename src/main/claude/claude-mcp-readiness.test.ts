import { describe, expect, it } from 'vitest'
import { projectClaudeMcpServerStatus } from './claude-mcp-readiness'

describe('projectClaudeMcpServerStatus', () => {
  it('keeps only readiness evidence and derives capabilities from annotations', () => {
    expect(
      projectClaudeMcpServerStatus([
        {
          name: 'linear',
          status: 'connected',
          error: 'secret diagnostic',
          config: { type: 'http', url: 'https://example.test/?token=secret' },
          tools: [
            {
              name: 'get_issue',
              description: 'sensitive description',
              annotations: { readOnly: true }
            },
            { name: 'update_issue', annotations: { readOnly: false } }
          ]
        }
      ])
    ).toEqual({
      state: 'verified',
      servers: [
        {
          name: 'linear',
          state: 'connected',
          capabilities: ['read', 'write'],
          capabilitiesVerified: true
        }
      ]
    })
  })

  it('marks connected servers without a tool listing as unverified', () => {
    expect(projectClaudeMcpServerStatus([{ name: 'linear', status: 'connected' }])).toMatchObject({
      servers: [{ capabilitiesVerified: false }]
    })
  })

  it('does not treat a tool listing with missing capability annotations as verified', () => {
    expect(
      projectClaudeMcpServerStatus([
        {
          name: 'linear',
          status: 'connected',
          tools: [{ name: 'unknown_tool', description: 'not capability evidence' }]
        }
      ])
    ).toEqual({
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
  })
})
