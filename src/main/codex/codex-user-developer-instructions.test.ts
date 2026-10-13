import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  codexUserConfigDefinesDeveloperInstructions,
  codexUserConfigDefinesDeveloperInstructionsAsync,
  codexUserDeveloperInstructionsInput
} from './codex-user-developer-instructions'

describe('codexUserConfigDefinesDeveloperInstructions', () => {
  let home: string
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'codex-dev-instructions-'))
  })
  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })
  const write = (content: string): void => writeFileSync(join(home, 'config.toml'), content)

  it('is false when there is no config file', () => {
    expect(codexUserConfigDefinesDeveloperInstructions(home)).toBe(false)
  })

  it('detects a top-level developer_instructions key', () => {
    write('model = "x"\ndeveloper_instructions = """\nbe terse\n"""\n')
    expect(codexUserConfigDefinesDeveloperInstructions(home)).toBe(true)
  })

  it('ignores the key in a profile that is not active', () => {
    write('model = "x"\n[profiles.a]\ndeveloper_instructions = "y"\n')
    expect(codexUserConfigDefinesDeveloperInstructions(home)).toBe(false)
    write('profile = "b"\n[profiles.a]\ndeveloper_instructions = "y"\n[profiles.b]\nmodel = "m"\n')
    expect(codexUserConfigDefinesDeveloperInstructions(home)).toBe(false)
  })

  it('detects the key in the active profile', () => {
    write('profile = "a"\n[profiles.a]\ndeveloper_instructions = "y"\n')
    expect(codexUserConfigDefinesDeveloperInstructions(home)).toBe(true)
  })

  it('reads the same answer asynchronously', async () => {
    write('developer_instructions = "x"\n')
    expect(await codexUserConfigDefinesDeveloperInstructionsAsync(home)).toBe(true)
  })

  it('skips remote and WSL hosts without reading the config', () => {
    const settings = { useOrcaBrowserForAgentWork: true }
    expect(codexUserDeveloperInstructionsInput('codex', settings, { isRemote: true })).toEqual({
      codexUserDeveloperInstructions: true
    })
    expect(
      codexUserDeveloperInstructionsInput('codex', settings, {
        isRemote: false,
        path: '\\\\wsl.localhost\\Ubuntu\\home\\me\\repo'
      })
    ).toEqual({ codexUserDeveloperInstructions: true })
    expect(codexUserDeveloperInstructionsInput('claude', settings, { isRemote: true })).toEqual({})
  })

  it('is conservative when the config cannot be parsed', () => {
    write('developer_instructions = [unterminated')
    expect(codexUserConfigDefinesDeveloperInstructions(home)).toBe(true)
  })

  it('is conservative when the config path is unreadable', () => {
    write('')
    expect(codexUserConfigDefinesDeveloperInstructions(join(home, 'config.toml'))).toBe(true)
  })
})
