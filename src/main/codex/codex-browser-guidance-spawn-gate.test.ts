import type * as fsPromises from 'node:fs/promises'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCA_BROWSER_AGENT_GUIDANCE } from '../../shared/agent-browser-guidance'
import { quoteStartupArg } from '../../shared/tui-agent-startup-shell'

// Why: keep the host's real /etc/codex out of the tests.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof fsPromises>()
  return {
    ...actual,
    readFile: (path: string, encoding: 'utf8') =>
      path === '/etc/codex/config.toml'
        ? Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
        : actual.readFile(path, encoding)
  }
})

import { gateCodexBrowserGuidance } from './codex-browser-guidance-spawn-gate'

const FRAGMENT = ['-c', `developer_instructions='${ORCA_BROWSER_AGENT_GUIDANCE}'`]
  .map((arg) => quoteStartupArg(arg, 'posix'))
  .join(' ')
const WITH = `codex ${FRAGMENT} --model x`
const WITHOUT = 'codex --model x'

describe('gateCodexBrowserGuidance', () => {
  let root: string
  let cwd: string
  let codexHome: string
  let savedCodexHome: string | undefined

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'codex-spawn-gate-'))
    cwd = join(root, 'project')
    codexHome = join(root, 'codex-home')
    mkdirSync(cwd)
    mkdirSync(codexHome)
    savedCodexHome = process.env.CODEX_HOME
    process.env.CODEX_HOME = codexHome
  })
  afterEach(() => {
    if (savedCodexHome === undefined) {
      delete process.env.CODEX_HOME
    } else {
      process.env.CODEX_HOME = savedCodexHome
    }
    rmSync(root, { recursive: true, force: true })
  })

  const gate = (overrides: Partial<Parameters<typeof gateCodexBrowserGuidance>[0]> = {}) =>
    gateCodexBrowserGuidance({
      command: WITH,
      connectionId: null,
      cwd,
      runtime: 'host',
      codexHomePaths: [],
      ...overrides
    })
  const writeConfig = (dir: string, content: string): void => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'config.toml'), content)
  }

  it('keeps the fragment when every layer is clean', async () => {
    await expect(gate()).resolves.toBe(WITH)
  })

  it.each([
    ['an SSH connection', { connectionId: 'ssh-1' }],
    ['an unknown cwd', { cwd: undefined }],
    ['a WSL runtime', { runtime: 'wsl' as const }],
    ['a WSL UNC cwd', { cwd: '\\\\wsl.localhost\\Ubuntu\\home\\me\\repo' }]
  ])('strips for %s', async (_name, overrides) => {
    await expect(gate(overrides)).resolves.toBe(WITHOUT)
  })

  it('strips when the cwd or a parent directory sets developer_instructions', async () => {
    writeConfig(join(cwd, '.codex'), 'developer_instructions = "x"\n')
    await expect(gate()).resolves.toBe(WITHOUT)
    rmSync(join(cwd, '.codex'), { recursive: true })
    writeConfig(join(root, '.codex'), 'developer_instructions = "x"\n')
    await expect(gate()).resolves.toBe(WITHOUT)
  })

  it('strips when a supplied home path sets developer_instructions', async () => {
    const other = join(root, 'account-home')
    writeConfig(other, 'developer_instructions = "x"\n')
    await expect(gate({ codexHomePaths: [null, other] })).resolves.toBe(WITHOUT)
  })

  it('strips on a selected profile, unparsable config, and an unreadable config path', async () => {
    writeConfig(codexHome, 'profile = "p"\n')
    await expect(gate()).resolves.toBe(WITHOUT)
    writeConfig(codexHome, 'not = = toml')
    await expect(gate()).resolves.toBe(WITHOUT)
    rmSync(join(codexHome, 'config.toml'))
    mkdirSync(join(codexHome, 'config.toml'))
    await expect(gate()).resolves.toBe(WITHOUT)
  })

  it('returns the command untouched without reading config when there is nothing to strip', async () => {
    await expect(gate({ command: undefined })).resolves.toBeUndefined()
    writeConfig(codexHome, 'developer_instructions = "x"\n')
    await expect(gate({ command: WITHOUT })).resolves.toBe(WITHOUT)
  })
})
