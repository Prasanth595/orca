import type * as fsPromises from 'node:fs/promises'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCA_BROWSER_AGENT_GUIDANCE } from '../../shared/agent-browser-guidance'
import { createSequencedSetupAgentCommands } from '../../shared/setup-agent-sequencing'
import { quoteStartupArg } from '../../shared/tui-agent-startup-shell'

const system = vi.hoisted(() => ({ home: '' }))
vi.mock('./codex-home-paths', () => ({ getSystemCodexHomePath: () => system.home }))

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
    system.home = join(root, 'system-home')
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

  const gateFull = (overrides: Partial<Parameters<typeof gateCodexBrowserGuidance>[0]> = {}) =>
    gateCodexBrowserGuidance({
      command: WITH,
      env: undefined,
      connectionId: null,
      cwd,
      runtime: 'host',
      codexHomePaths: [],
      ...overrides
    })
  const gate = async (overrides: Partial<Parameters<typeof gateCodexBrowserGuidance>[0]> = {}) =>
    (await gateFull(overrides)).command
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

  describe('setup-sequenced launches', () => {
    const sequenced = (
      platform: Parameters<typeof createSequencedSetupAgentCommands>[0]['platform'],
      startupCommand: string
    ) => {
      const { startupCommand: ptyCommand, startupEnv } = createSequencedSetupAgentCommands({
        runnerScriptPath: platform === 'windows' ? 'C:\\r\\setup.cmd' : '/r/setup.sh',
        startupCommand,
        platform,
        nonce: 'n1'
      })
      const env: Record<string, string> = { ...startupEnv, KEEP: '1' }
      return { command: ptyCommand, env }
    }
    const POSIX_CASES = [
      ['posix', WITH, WITHOUT],
      ['posix with env prefix', `FOO=1 ${WITH}`, `FOO=1 ${WITHOUT}`],
      ['posix chained', `${WITH} && echo done`, `${WITHOUT} && echo done`]
    ] as const

    it.each(POSIX_CASES)(
      'strips command, COMMAND and SCRIPT when blocked: %s',
      async (_n, cmd, clean) => {
        writeConfig(join(cwd, '.codex'), 'developer_instructions = "x"\n')
        const input = sequenced('posix', cmd)
        expect(input.env.ORCA_SEQUENCED_STARTUP_SCRIPT).toContain(ORCA_BROWSER_AGENT_GUIDANCE)
        const out = await gateFull(input)
        expect(out.command).toBe(input.command)
        expect(out.env?.ORCA_SEQUENCED_STARTUP_COMMAND).not.toContain(ORCA_BROWSER_AGENT_GUIDANCE)
        expect(out.env?.ORCA_SEQUENCED_STARTUP_SCRIPT).not.toContain(ORCA_BROWSER_AGENT_GUIDANCE)
        // A fail-closed script would also lack the guidance; it must equal one built without it.
        expect(out.env?.ORCA_SEQUENCED_STARTUP_SCRIPT).toBe(
          sequenced('posix', clean).env.ORCA_SEQUENCED_STARTUP_SCRIPT
        )
        expect(out.env?.KEEP).toBe('1')
      }
    )

    it('strips the Windows sequenced command when blocked', async () => {
      writeConfig(join(cwd, '.codex'), 'developer_instructions = "x"\n')
      const psFragment = ['-c', `developer_instructions='${ORCA_BROWSER_AGENT_GUIDANCE}'`]
        .map((arg) => quoteStartupArg(arg, 'powershell'))
        .join(' ')
      const input = sequenced('windows', `codex ${psFragment} --model x`)
      expect(input.env.ORCA_SEQUENCED_STARTUP_COMMAND).toContain(ORCA_BROWSER_AGENT_GUIDANCE)
      const out = await gateFull(input)
      expect(out.env?.ORCA_SEQUENCED_STARTUP_COMMAND).toBe('codex --model x')
    })

    it('keeps command and both env values for a clean config', async () => {
      const input = sequenced('posix', WITH)
      const out = await gateFull(input)
      expect(out.env).toBe(input.env)
      expect(out.env?.ORCA_SEQUENCED_STARTUP_SCRIPT).toContain(ORCA_BROWSER_AGENT_GUIDANCE)
    })

    it('strips env values when the host cannot read the config', async () => {
      const out = await gateFull({ ...sequenced('posix', WITH), connectionId: 'ssh-1' })
      expect(out.env?.ORCA_SEQUENCED_STARTUP_SCRIPT).not.toContain(ORCA_BROWSER_AGENT_GUIDANCE)
    })
  })
})
