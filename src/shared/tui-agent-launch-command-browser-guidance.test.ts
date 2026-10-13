import { describe, expect, it } from 'vitest'
import { ORCA_BROWSER_AGENT_GUIDANCE as TEXT } from './agent-browser-guidance'
import { resolveAgentLaunchCommand } from './tui-agent-launch-command'

function resolve(overrides: Partial<Parameters<typeof resolveAgentLaunchCommand>[0]> = {}) {
  const result = resolveAgentLaunchCommand({
    agent: 'claude',
    cmdOverrides: {},
    platform: 'linux',
    shell: 'posix',
    orcaBrowserGuidance: true,
    ...overrides
  })
  if (!result.ok) {
    throw new Error(result.error)
  }
  return result
}

describe('resolveAgentLaunchCommand Orca browser guidance', () => {
  it('adds guidance to the launch command but not the resume-safe command', () => {
    const result = resolve({ agentArgs: '--model x' })
    expect(result.command).toBe(`claude '--append-system-prompt' '${TEXT}' '--model' 'x'`)
    expect(result.commandWithoutSessionOptions).toBe(`claude '--model' 'x'`)
    expect(result.appliedSessionOptions).toEqual({})
  })

  it('is absent when the flag is off or the host is remote', () => {
    expect(resolve({ orcaBrowserGuidance: false }).command).toBe('claude')
    expect(resolve({ isRemote: true }).command).not.toContain(TEXT)
  })

  it('quotes Claude guidance per shell', () => {
    expect(resolve({ shell: 'powershell' }).command).toBe(
      `claude '--append-system-prompt' '${TEXT}'`
    )
    expect(resolve({ shell: 'cmd' }).command).toBe(`claude "--append-system-prompt" "${TEXT}"`)
  })

  it('quotes Codex TOML literal guidance per shell', () => {
    const value = `developer_instructions='${TEXT}'`
    expect(
      resolve({ agent: 'codex', shell: 'posix', codexUserDeveloperInstructions: false }).command
    ).toBe(`codex '-c' 'developer_instructions='"'"'${TEXT}'"'"`)
    expect(
      resolve({ agent: 'codex', shell: 'powershell', codexUserDeveloperInstructions: false })
        .command
    ).toBe(`codex '-c' '${value.replaceAll("'", "''")}'`)
    expect(
      resolve({ agent: 'codex', shell: 'cmd', codexUserDeveloperInstructions: false }).command
    ).toBe(`codex "-c" "${value}"`)
  })

  it('places guidance before the terminator and user args', () => {
    const { command } = resolve({ agentArgs: '--model x -- hi' })
    expect(command).toBe(`claude '--append-system-prompt' '${TEXT}' '--model' 'x' '--' 'hi'`)
  })

  it('places guidance before the terminator when session options override agent args', () => {
    const { command } = resolve({
      agentArgs: '--model x -- hi',
      sessionOptionsOverrideAgentArgs: true,
      sessionOptions: {}
    })
    expect(command.indexOf(TEXT)).toBeGreaterThan(-1)
    expect(command.indexOf(TEXT)).toBeLessThan(command.indexOf("'--' 'hi'"))
  })

  it('dedupes against user args and command overrides', () => {
    expect(resolve({ agentArgs: '--append-system-prompt mine' }).command).not.toContain(TEXT)
    expect(
      resolve({ cmdOverrides: { claude: 'claude --append-system-prompt mine' } }).command
    ).not.toContain(TEXT)
    expect(
      resolve({
        agent: 'codex',
        agentArgs: '-c developer_instructions=x',
        codexUserDeveloperInstructions: false
      }).command
    ).not.toContain(TEXT)
  })

  it('skips Codex guidance unless the user config is explicitly clear', () => {
    expect(resolve({ agent: 'codex' }).command).toBe('codex')
  })

  it('skips guidance when Codex user config defines developer instructions', () => {
    expect(resolve({ agent: 'codex', codexUserDeveloperInstructions: true }).command).toBe('codex')
  })

  it('skips guidance when the command override cannot be tokenized', () => {
    expect(resolve({ cmdOverrides: { claude: '"unfinished' } }).command).not.toContain(TEXT)
  })
})
