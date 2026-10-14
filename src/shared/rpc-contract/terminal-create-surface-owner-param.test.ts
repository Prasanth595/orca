import { describe, expect, it } from 'vitest'
import { TerminalCreateParams } from './terminal-unary-params'

describe('TerminalCreateParams.surfaceOwner', () => {
  it('carries the sidebar opt-out and stays absent by default', () => {
    expect(
      TerminalCreateParams.parse({ worktree: 'path:/repo', surfaceOwner: false }).surfaceOwner
    ).toBe(false)
    expect(TerminalCreateParams.parse({ worktree: 'path:/repo' })).not.toHaveProperty(
      'surfaceOwner'
    )
  })

  // A peer that spells the default out must keep creating terminals, as it did when the key was stripped.
  it('accepts an explicit true', () => {
    expect(
      TerminalCreateParams.parse({ worktree: 'path:/repo', surfaceOwner: true }).surfaceOwner
    ).toBe(true)
  })
})
