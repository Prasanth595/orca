import { describe, expect, it } from 'vitest'
import { ORCA_BROWSER_AGENT_GUIDANCE, orcaBrowserGuidanceArgs } from './agent-browser-guidance'

const CLAUDE_ARGS = ['--append-system-prompt', ORCA_BROWSER_AGENT_GUIDANCE]
const NOT_DEFINED = { codexUserDeveloperInstructions: false }
const CODEX_ARGS = ['-c', `developer_instructions='${ORCA_BROWSER_AGENT_GUIDANCE}'`]

describe('ORCA_BROWSER_AGENT_GUIDANCE', () => {
  it('is one short ASCII line without shell or TOML metacharacters', () => {
    expect(ORCA_BROWSER_AGENT_GUIDANCE).toMatch(/^[\x20-\x7e]+$/)
    expect(ORCA_BROWSER_AGENT_GUIDANCE).not.toMatch(/['"%!$^&|<>()\\`]/)
    expect(Buffer.byteLength(ORCA_BROWSER_AGENT_GUIDANCE)).toBeLessThanOrEqual(300)
  })
})

describe('orcaBrowserGuidanceArgs', () => {
  it('appends a Claude system prompt', () => {
    expect(orcaBrowserGuidanceArgs('claude', [])).toEqual(CLAUDE_ARGS)
    expect(orcaBrowserGuidanceArgs('claude', ['--model', 'opus'])).toEqual(CLAUDE_ARGS)
  })

  it('skips Claude when the user already appends a system prompt', () => {
    expect(orcaBrowserGuidanceArgs('claude', ['--append-system-prompt', 'x'])).toEqual([])
    expect(orcaBrowserGuidanceArgs('claude', ['--append-system-prompt=x'])).toEqual([])
    expect(orcaBrowserGuidanceArgs('claude', ['--append-system-prompt-file', 'f'])).toEqual([])
  })

  it('ignores Claude options after the terminator', () => {
    expect(orcaBrowserGuidanceArgs('claude', ['--', '--append-system-prompt', 'x'])).toEqual(
      CLAUDE_ARGS
    )
  })

  it('injects Codex developer instructions', () => {
    expect(orcaBrowserGuidanceArgs('codex', [], NOT_DEFINED)).toEqual(CODEX_ARGS)
    expect(orcaBrowserGuidanceArgs('codex', ['-c', 'model=x'], NOT_DEFINED)).toEqual(CODEX_ARGS)
  })

  it.each([
    [['-c', 'developer_instructions=x']],
    [['--config=developer_instructions=x']],
    [['--config', 'developer_instructions = "x"']],
    [['-cdeveloper_instructions=x']],
    [['-c', 'model=x', '-c', 'developer_instructions=x']]
  ])('skips Codex when the user sets developer_instructions: %j', (tokens) => {
    expect(orcaBrowserGuidanceArgs('codex', tokens, NOT_DEFINED)).toEqual([])
  })

  it('skips Codex when the user config file defines developer_instructions', () => {
    expect(orcaBrowserGuidanceArgs('codex', [], { codexUserDeveloperInstructions: true })).toEqual(
      []
    )
  })

  it('skips Codex when the user config answer is unknown', () => {
    expect(orcaBrowserGuidanceArgs('codex', [])).toEqual([])
  })

  it.each([[['-p', 'work']], [['--profile', 'work']], [['--profile=work']]])(
    'skips Codex when a profile is selected: %j',
    (tokens) => {
      expect(orcaBrowserGuidanceArgs('codex', tokens, NOT_DEFINED)).toEqual([])
    }
  )

  it('ignores Codex config after the terminator', () => {
    expect(
      orcaBrowserGuidanceArgs('codex', ['--', '-c', 'developer_instructions=x'], NOT_DEFINED)
    ).toEqual(CODEX_ARGS)
  })

  it('does nothing for other agents', () => {
    expect(orcaBrowserGuidanceArgs('gemini', [])).toEqual([])
    expect(orcaBrowserGuidanceArgs('opencode', [])).toEqual([])
  })
})
