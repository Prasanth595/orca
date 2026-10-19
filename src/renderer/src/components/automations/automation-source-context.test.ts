import { describe, expect, it } from 'vitest'
import { getRepoBackedAutomationSourceContext } from './automation-source-context'
import type { Automation } from '../../../../shared/automations-types'

function automationWith(provider: string): Automation {
  return {
    sourceContext: {
      kind: 'task-source',
      provider,
      projectId: 'p',
      hostId: 'local'
    }
  } as unknown as Automation
}

describe('getRepoBackedAutomationSourceContext', () => {
  it('resolves repo-backed providers and rejects local', () => {
    expect(getRepoBackedAutomationSourceContext(automationWith('github'))).not.toBeNull()
    expect(getRepoBackedAutomationSourceContext(automationWith('gitlab'))).not.toBeNull()
    // Why: no provider has event triggers today (scheduled/manual only), so a
    // selectable-but-never-firing local source would read as broken (U5).
    expect(getRepoBackedAutomationSourceContext(automationWith('local'))).toBeNull()
    expect(getRepoBackedAutomationSourceContext(automationWith('linear'))).toBeNull()
    expect(getRepoBackedAutomationSourceContext(automationWith('jira'))).toBeNull()
  })
})
