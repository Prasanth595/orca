import { describe, expect, it } from 'vitest'
import { ORCA_BROWSER_AGENT_GUIDANCE as TEXT } from './agent-browser-guidance'
import {
  buildAgentDraftLaunchPlan,
  buildAgentResumeStartupPlan,
  buildAgentStartupPlan
} from './tui-agent-startup'

describe('Orca browser guidance in startup plans', () => {
  it('reaches the launch command but not the stored launch config or resume command', () => {
    const plan = buildAgentStartupPlan({
      agent: 'claude',
      prompt: 'fix it',
      cmdOverrides: {},
      platform: 'linux',
      orcaBrowserGuidance: true
    })
    expect(plan?.launchCommand).toContain(TEXT)
    expect(plan?.launchConfig.agentCommand).not.toContain(TEXT)

    const resume = buildAgentResumeStartupPlan({
      agent: 'claude',
      cmdOverrides: {},
      platform: 'linux',
      agentCommand: plan?.launchConfig.agentCommand,
      providerSession: { key: 'session_id', id: 'abc' }
    })
    expect(resume?.launchCommand).not.toContain(TEXT)
  })

  it('applies to draft launches without leaking into their launch config', () => {
    const plan = buildAgentDraftLaunchPlan({
      agent: 'claude',
      draft: 'hello',
      cmdOverrides: {},
      platform: 'linux',
      orcaBrowserGuidance: true
    })
    expect(plan?.launchCommand).toContain(TEXT)
    expect(plan?.launchConfig.agentCommand).not.toContain(TEXT)
  })

  it('is absent when not requested and for remote launches', () => {
    const base = {
      agent: 'claude' as const,
      prompt: 'x',
      cmdOverrides: {},
      platform: 'linux' as const
    }
    expect(buildAgentStartupPlan(base)?.launchCommand).not.toContain(TEXT)
    expect(
      buildAgentStartupPlan({ ...base, orcaBrowserGuidance: true, isRemote: true })?.launchCommand
    ).not.toContain(TEXT)
  })
})
