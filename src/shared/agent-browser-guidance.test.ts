import { describe, expect, it } from 'vitest'
import {
  ORCA_BROWSER_AGENT_GUIDANCE,
  orcaBrowserGuidanceArgs,
  stripCodexBrowserGuidance
} from './agent-browser-guidance'
import { quoteStartupArg } from './tui-agent-startup-shell'

const CLAUDE_ARGS = ['--append-system-prompt', ORCA_BROWSER_AGENT_GUIDANCE]
const GATED = { codexGuidanceSpawnGated: true }
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
    expect(orcaBrowserGuidanceArgs('codex', [], GATED)).toEqual(CODEX_ARGS)
    expect(orcaBrowserGuidanceArgs('codex', ['-c', 'model=x'], GATED)).toEqual(CODEX_ARGS)
  })

  it.each([
    [['-c', 'developer_instructions=x']],
    [['--config=developer_instructions=x']],
    [['--config', 'developer_instructions = "x"']],
    [['-cdeveloper_instructions=x']],
    [['-c', 'model=x', '-c', 'developer_instructions=x']]
  ])('skips Codex when the user sets developer_instructions: %j', (tokens) => {
    expect(orcaBrowserGuidanceArgs('codex', tokens, GATED)).toEqual([])
  })

  it('skips Codex unless the launch is spawn-gated', () => {
    expect(orcaBrowserGuidanceArgs('codex', [])).toEqual([])
    expect(orcaBrowserGuidanceArgs('codex', [], { codexGuidanceSpawnGated: false })).toEqual([])
  })

  it.each([[['-p', 'work']], [['--profile', 'work']], [['--profile=work']]])(
    'skips Codex when a profile is selected: %j',
    (tokens) => {
      expect(orcaBrowserGuidanceArgs('codex', tokens, GATED)).toEqual([])
    }
  )

  it('ignores Codex config after the terminator', () => {
    expect(
      orcaBrowserGuidanceArgs('codex', ['--', '-c', 'developer_instructions=x'], GATED)
    ).toEqual(CODEX_ARGS)
  })

  it('does nothing for other agents', () => {
    expect(orcaBrowserGuidanceArgs('gemini', [])).toEqual([])
    expect(orcaBrowserGuidanceArgs('opencode', [])).toEqual([])
  })
})

describe('stripCodexBrowserGuidance', () => {
  it.each(['posix', 'powershell', 'cmd'] as const)('removes the fragment for %s', (shell) => {
    const fragment = CODEX_ARGS.map((arg) => quoteStartupArg(arg, shell)).join(' ')
    expect(stripCodexBrowserGuidance(`codex ${fragment} --model x`)).toBe('codex --model x')
  })

  it('leaves a user developer_instructions flag and Claude guidance untouched', () => {
    const user = "codex -c 'developer_instructions=mine'"
    const claude = `claude --append-system-prompt '${ORCA_BROWSER_AGENT_GUIDANCE}'`
    expect(stripCodexBrowserGuidance(user)).toBe(user)
    expect(stripCodexBrowserGuidance(claude)).toBe(claude)
    expect(stripCodexBrowserGuidance('codex')).toBe('codex')
  })
})
