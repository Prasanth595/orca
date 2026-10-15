import { describe, expect, it } from 'vitest'
import { effectiveAllowedFlags, findCommandSpec } from '../args'
import { formatCommandHelp } from '../help'
import { COMMAND_SPECS } from './index'

function specFor(path: string[]) {
  const spec = findCommandSpec(COMMAND_SPECS, path)
  if (!spec) {
    throw new Error(`no spec for ${path.join(' ')}`)
  }
  return spec
}

describe('orca comment command specs', () => {
  it('resolves delete and remove to the rm spec, which is marked destructive', () => {
    const rm = specFor(['comment', 'rm'])
    expect(specFor(['comment', 'delete'])).toBe(rm)
    expect(specFor(['comment', 'remove'])).toBe(rm)
    expect(rm.destructive).toBe(true)
  })

  it('does not offer the browser --page flag', () => {
    for (const command of ['list', 'rm', 'edit']) {
      expect(effectiveAllowedFlags(specFor(['comment', command]))).not.toContain('page')
    }
  })

  it('describes the comment flags in help rather than printing them bare', () => {
    const help = formatCommandHelp(specFor(['comment', 'edit']))
    expect(help).toContain('--body <text>')
    expect(help).toContain('Comment id from orca comment list')
  })
})
