import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { codexConfigBlocksBrowserGuidance } from './codex-user-developer-instructions'

describe('codexConfigBlocksBrowserGuidance', () => {
  let root: string
  let cwd: string
  let codexHome: string
  let savedCodexHome: string | undefined

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'codex-config-gate-'))
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

  const check = (homePaths: (string | null | undefined)[] = []) =>
    codexConfigBlocksBrowserGuidance({
      homePaths,
      cwd,
      systemConfigPath: null
    })
  const writeHome = (home: string, content: string): void => {
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, 'config.toml'), content)
  }

  it('passes when no config exists anywhere (ENOENT)', async () => {
    await expect(check()).resolves.toBe(false)
  })

  it('blocks on developer_instructions in the user config', async () => {
    writeHome(codexHome, 'model = "x"\ndeveloper_instructions = """\nbe terse\n"""\n')
    await expect(check()).resolves.toBe(true)
  })

  it('blocks on a selected profile and ignores unselected profile tables', async () => {
    writeHome(codexHome, 'profile = "p"\n')
    await expect(check()).resolves.toBe(true)
    writeHome(codexHome, '[profiles.a]\ndeveloper_instructions = "y"\n')
    await expect(check()).resolves.toBe(false)
  })

  it('blocks on unparsable config and unreadable config paths', async () => {
    writeHome(codexHome, 'this is = = not toml')
    await expect(check()).resolves.toBe(true)
    rmSync(join(codexHome, 'config.toml'))
    mkdirSync(join(codexHome, 'config.toml'))
    await expect(check()).resolves.toBe(true)
  })

  it('checks every distinct home path and skips empty ones', async () => {
    const other = join(root, 'other-home')
    writeHome(other, 'developer_instructions = "x"\n')
    await expect(check([null, undefined, ''])).resolves.toBe(false)
    await expect(check([codexHome, codexHome, other])).resolves.toBe(true)
  })

  it('checks project configs from cwd up to the root', async () => {
    const parentCodex = join(root, '.codex')
    writeHome(parentCodex, 'developer_instructions = "x"\n')
    await expect(check()).resolves.toBe(true)
  })

  it('does not read a user config twice when it is also a project path', async () => {
    writeHome(join(cwd, '.codex'), 'model = "x"\n')
    await expect(check([join(cwd, '.codex')])).resolves.toBe(false)
  })

  it('checks the system config when one is given', async () => {
    const systemConfigPath = join(root, 'system.toml')
    writeFileSync(systemConfigPath, 'developer_instructions = "x"\n')
    await expect(
      codexConfigBlocksBrowserGuidance({
        homePaths: [],
        cwd,
        systemConfigPath
      })
    ).resolves.toBe(true)
  })
})
