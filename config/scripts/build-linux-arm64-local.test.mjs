import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runProcessSync } from '@orca/process-host'

const driver = fileURLToPath(new URL('./build-linux-arm64-local.sh', import.meta.url))
let root
let source
let staging

// Windows runs the same path checks through WSL; the standard Linux unit runner has Bash.
describe.skipIf(process.platform === 'win32')('local ARM64 staging safety', () => {
  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'orca-arm64-staging-')))
    source = join(root, 'source')
    staging = join(root, 'builds', 'arm64')
    await mkdir(source)
    await mkdir(join(root, 'builds'))
    await mkdir(join(root, 'outside'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  function check(path = staging, command = 'validate_staging_paths "$3" "$4"') {
    return runProcessSync({
      program: 'bash',
      args: [
        '--noprofile',
        '--norc',
        '-c',
        `source "$1"; staging_parent="$2"; work="$3"; ${command}`,
        'staging-test',
        driver,
        join(root, 'builds'),
        path,
        source
      ]
    })
  }

  it('accepts a dedicated absolute build directory', () => {
    expect(check().code).toBe(0)
  })

  it('rejects filesystem roots, homes, source paths, and unnormalized paths', () => {
    for (const path of [
      '/',
      '/home',
      '/root',
      '/home/developer',
      'relative',
      source,
      join(root, 'builds'),
      `${staging}/../other`,
      `${staging}/`
    ]) {
      expect(check(path).code, path).not.toBe(0)
    }
    expect(check(staging, 'validate_staging_paths "$3" "$3"').code).not.toBe(0)
  })

  it.each([
    '',
    'x64',
    'arm64',
    'arm64/out',
    'arm64/dist',
    'arm64/node_modules',
    'arm64/.git',
    'arm64/native/wayland-clipboard/.build',
    'cache',
    'artifacts',
    'artifacts/latest-artifact',
    'javascript-tree'
  ])('rejects a symlink escape at %s', async (path) => {
    const link = path ? join(staging, path) : staging
    await mkdir(join(link, '..'), { recursive: true })
    await symlink(join(root, 'outside'), link)
    expect(check().code).not.toBe(0)
  })

  it('checks both architectures before any sync mutation', async () => {
    await mkdir(join(staging, 'x64'), { recursive: true })
    await writeFile(join(staging, 'x64', 'sentinel'), 'unchanged')
    await symlink(join(root, 'outside'), join(staging, 'arm64'))
    const result = check(staging, 'sync_source "$4" invalid-base invalid-snapshot 1')
    expect(result.code).not.toBe(0)
    expect(await readFile(join(staging, 'x64', 'sentinel'), 'utf8')).toBe('unchanged')
    expect(await readFile(join(staging, '.orca-linux-arm64-source')).catch(() => null)).toBe(null)
  })

  it('refuses unmarked or differently owned existing staging', async () => {
    await mkdir(staging)
    await writeFile(join(staging, 'sentinel'), 'keep')
    expect(check(staging, 'sync_source "$4" invalid-base invalid-snapshot 0').code).not.toBe(0)
    await writeFile(join(staging, '.orca-linux-arm64-source'), join(root, 'outside'))
    expect(check(staging, 'sync_source "$4" invalid-base invalid-snapshot 1').code).not.toBe(0)
    expect(await readFile(join(staging, 'sentinel'), 'utf8')).toBe('keep')
  })
})
