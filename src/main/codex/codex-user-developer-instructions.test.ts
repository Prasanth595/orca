import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

  it('treats a profile selected in the user config as defined', () => {
    write('profile = "p"\nmodel = "x"\n')
    expect(codexUserConfigDefinesDeveloperInstructions(home)).toBe(true)
  })

  it('allows guidance for profile tables that nothing selects', () => {
    write('[profiles.a]\ndeveloper_instructions = "y"\n')
    expect(codexUserConfigDefinesDeveloperInstructions(home)).toBe(false)
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
    expect(codexUserDeveloperInstructionsInput('codex', settings, { isRemote: false })).toEqual({
      codexUserDeveloperInstructions: true
    })
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

  describe('project .codex/config.toml', () => {
    let project: string
    const writeProject = (dir: string, content: string): void => {
      mkdirSync(join(dir, '.codex'), { recursive: true })
      writeFileSync(join(dir, '.codex', 'config.toml'), content)
    }
    beforeEach(() => {
      project = mkdtempSync(join(tmpdir(), 'codex-project-'))
      mkdirSync(join(project, 'a', 'b'), { recursive: true })
    })
    afterEach(() => {
      rmSync(project, { recursive: true, force: true })
    })
    const cwd = (): string => join(project, 'a', 'b')

    it('detects the key in the config at the cwd', () => {
      writeProject(cwd(), 'developer_instructions = "x"\n')
      expect(codexUserConfigDefinesDeveloperInstructions(home, cwd())).toBe(true)
    })

    it('detects the key in a parent directory config', async () => {
      writeProject(project, 'developer_instructions = "x"\n')
      expect(codexUserConfigDefinesDeveloperInstructions(home, cwd())).toBe(true)
      expect(await codexUserConfigDefinesDeveloperInstructionsAsync(home, cwd())).toBe(true)
    })

    it('blocks when a project selects a profile the user config defines, and the reverse', () => {
      write('[profiles.p]\ndeveloper_instructions = "x"\n')
      writeProject(project, 'profile = "p"\n')
      expect(codexUserConfigDefinesDeveloperInstructions(home, cwd())).toBe(true)
      write('profile = "p"\n')
      writeProject(project, '[profiles.p]\ndeveloper_instructions = "x"\n')
      expect(codexUserConfigDefinesDeveloperInstructions(home, cwd())).toBe(true)
    })

    it('blocks when a profile and its table are split across parent and child projects', async () => {
      writeProject(project, '[profiles.p]\ndeveloper_instructions = "x"\n')
      writeProject(cwd(), 'profile = "p"\n')
      expect(codexUserConfigDefinesDeveloperInstructions(home, cwd())).toBe(true)
      expect(await codexUserConfigDefinesDeveloperInstructionsAsync(home, cwd())).toBe(true)
    })

    it('blocks on a profile in any single project layer', () => {
      writeProject(project, 'profile = "p"\n')
      expect(codexUserConfigDefinesDeveloperInstructions(home, cwd())).toBe(true)
    })

    it('allows guidance when project configs lack the key', async () => {
      writeProject(project, 'model = "x"\n')
      expect(codexUserConfigDefinesDeveloperInstructions(home, cwd())).toBe(false)
      expect(await codexUserConfigDefinesDeveloperInstructionsAsync(home, cwd())).toBe(false)
    })

    it('is conservative when a project config is unreadable', () => {
      writeProject(project, 'developer_instructions = [broken')
      expect(codexUserConfigDefinesDeveloperInstructions(home, cwd())).toBe(true)
    })

    it('ignores project configs when no cwd is given', () => {
      writeProject(project, 'developer_instructions = "x"\n')
      expect(codexUserConfigDefinesDeveloperInstructions(home)).toBe(false)
    })

    it('does not read the user config twice when the cwd is under its parent', () => {
      mkdirSync(join(project, '.codex'), { recursive: true })
      expect(codexUserConfigDefinesDeveloperInstructions(join(project, '.codex'), cwd())).toBe(
        false
      )
    })
  })
})
