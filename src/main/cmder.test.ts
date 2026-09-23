import { describe, expect, it } from 'vitest'
import {
  applyCmderSpawnEnvironment,
  getCmderRootCandidates,
  resolveCmderRoot,
  resolveWindowsCmderShellRoot
} from './cmder'

describe('Cmder discovery', () => {
  it('prefers CMDER_ROOT and strips quotes and trailing separators', () => {
    const candidates = getCmderRootCandidates({
      CMDER_ROOT: '"C:\\programs\\cmder\\"',
      USERPROFILE: 'C:\\Users\\alice'
    })
    expect(candidates[0]).toBe('C:\\programs\\cmder')
    expect(candidates).toContain('C:\\Users\\alice\\scoop\\apps\\cmder\\current')
  })

  it('resolves the first root whose vendor init.bat exists', () => {
    expect(
      resolveCmderRoot({
        platform: 'win32',
        env: { CMDER_ROOT: 'D:\\missing', USERPROFILE: 'C:\\Users\\alice' },
        exists: (path) => path === 'C:\\Users\\alice\\cmder\\vendor\\init.bat'
      })
    ).toBe('C:\\Users\\alice\\cmder')
  })

  it('never resolves off Windows', () => {
    expect(
      resolveCmderRoot({ platform: 'linux', env: { CMDER_ROOT: 'C:\\cmder' }, exists: () => true })
    ).toBeNull()
  })

  it('only maps the cmder sentinel', () => {
    const options = {
      platform: 'win32' as const,
      env: { CMDER_ROOT: 'C:\\cmder' },
      exists: () => true
    }
    expect(resolveWindowsCmderShellRoot('Cmder', options)).toBe('C:\\cmder')
    expect(resolveWindowsCmderShellRoot('cmd.exe', options)).toBeNull()
  })

  it('sets CMDER_ROOT and the init path/quote pair', () => {
    const env: Record<string, string> = {}
    applyCmderSpawnEnvironment(env, 'C:\\Program Files\\cmder')
    expect(env).toEqual({
      CMDER_ROOT: 'C:\\Program Files\\cmder',
      ORCA_CMDER_INIT: 'C:\\Program Files\\cmder\\vendor\\init.bat',
      ORCA_CMDER_INIT_QUOTE: '"'
    })
  })
})
