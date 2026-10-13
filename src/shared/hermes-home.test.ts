import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveDefaultHermesHomeDir, resolveHermesHomeDir } from './hermes-home'

/**
 * The default-home branches themselves are asserted through
 * `resolveDefaultHermesSkillsRoot` in `src/main/skills/skill-provider-runtime-roots.test.ts`,
 * which has covered them since Hermes skills discovery got its Windows layout. These cover the
 * platform this test runs on and the `HERMES_HOME` override.
 */
describe('resolveHermesHomeDir', () => {
  it('resolves the home of the platform it runs on', () => {
    const localAppData = process.platform === 'win32' ? process.env.LOCALAPPDATA : undefined
    expect(resolveDefaultHermesHomeDir({ directoryExists: () => true })).toBe(
      localAppData ? join(localAppData, 'hermes') : join(homedir(), '.hermes')
    )
  })

  it('uses an absolute HERMES_HOME as the home itself', () => {
    const custom = join(homedir(), 'hermes-elsewhere')
    expect(resolveHermesHomeDir({ HERMES_HOME: ` ${custom} ` })).toBe(custom)
  })

  it('ignores a relative HERMES_HOME, which would resolve against Orca’s cwd', () => {
    expect(resolveHermesHomeDir({ HERMES_HOME: 'relative/hermes' })).toBe(
      resolveDefaultHermesHomeDir({ env: {} })
    )
  })

  it('does not stat anything when Windows exposes no usable LOCALAPPDATA', () => {
    const seen: string[] = []
    const resolved = resolveDefaultHermesHomeDir({
      homeDir: join('/users', 'alice'),
      platform: 'win32',
      env: { LOCALAPPDATA: 'relative\\local' },
      directoryExists: (candidate) => {
        seen.push(candidate)
        return true
      }
    })
    expect(resolved).toBe(join('/users', 'alice', '.hermes'))
    // A rejected LOCALAPPDATA must not cost a stat: there is nothing to compare.
    expect(seen).toEqual([])
  })
})
