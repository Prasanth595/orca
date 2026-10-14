import { describe, expect, it } from 'vitest'
import { findCommandSpec } from '../args'
import { formatCommandHelp } from '../help'
import { COMMAND_SPECS } from './index'

function terminalCreateHelp(): string {
  const spec = findCommandSpec(COMMAND_SPECS, ['terminal', 'create'])
  if (!spec) {
    throw new Error('no spec for terminal create')
  }
  return formatCommandHelp(spec)
}

describe('orca terminal create help', () => {
  it('documents --no-reveal as the alternative to --focus', () => {
    const help = terminalCreateHelp()

    expect(help).toContain('[--focus|--no-reveal]')
    expect(help.split('\n').find((line) => line.trimStart().startsWith('--no-reveal '))).toBe(
      '  --no-reveal            Add the terminal tab without revealing its worktree in the sidebar'
    )
    expect(help).toContain('it cannot be combined with --focus')
  })
})
