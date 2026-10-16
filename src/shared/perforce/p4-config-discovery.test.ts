import { describe, expect, it } from 'vitest'
import { join, resolve } from 'node:path'
import { discoverP4ConfigName } from './p4-config-discovery'

const root = resolve('/work/p4/client')
// An empty P4ENVIRO path keeps the developer's own ~/.p4enviro out of these cases.
const NO_ENVIRO = { P4ENVIRO: '/nonexistent/p4enviro' }
const files = (...paths: string[]) => {
  const set = new Set(paths.map((p) => resolve(p)))
  return (path: string) => set.has(resolve(path))
}

describe('discoverP4ConfigName', () => {
  it('finds .p4config in the workspace root', () => {
    expect(discoverP4ConfigName(root, NO_ENVIRO, files(join(root, '.p4config')))).toBe('.p4config')
  })

  it('walks up from a nested folder and prefers the nearest file', () => {
    const nested = join(root, 'src', 'lib')
    expect(discoverP4ConfigName(nested, NO_ENVIRO, files(join(root, '.p4config')))).toBe(
      '.p4config'
    )
    expect(
      discoverP4ConfigName(
        nested,
        NO_ENVIRO,
        files(join(root, 'src', 'p4config.txt'), join(root, '.p4config'))
      )
    ).toBe('p4config.txt')
  })

  it('leaves an inherited P4CONFIG in charge', () => {
    expect(
      discoverP4ConfigName(root, { P4CONFIG: 'custom.cfg' }, files(join(root, '.p4config')))
    ).toBeNull()
  })

  it('leaves a P4CONFIG chosen with p4 set (P4ENVIRO) in charge', () => {
    const enviro = (contents: string) => (path: string) =>
      path === '/cfg/enviro' ? contents : null
    const exists = files(join(root, '.p4config'))
    const env = { P4ENVIRO: '/cfg/enviro' }
    expect(discoverP4ConfigName(root, env, exists, enviro('P4CONFIG=.p4cfg\n'))).toBeNull()
    expect(discoverP4ConfigName(root, env, exists, enviro('P4IGNORE=.p4ignore\n'))).toBe(
      '.p4config'
    )
  })

  it('returns null when no config file exists', () => {
    expect(discoverP4ConfigName(root, NO_ENVIRO, files())).toBeNull()
  })
})
