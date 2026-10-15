import { describe, expect, it } from 'vitest'
import { AUTOMATION_TASK_PROVIDERS, isAutomationTaskProvider } from './automation-task-providers'
import { TASK_PROVIDERS } from './task-providers'

describe('automation task providers', () => {
  it('only accepts task providers that opted in to automations', () => {
    expect(AUTOMATION_TASK_PROVIDERS.every((provider) => TASK_PROVIDERS.includes(provider))).toBe(
      true
    )
    expect(TASK_PROVIDERS.filter(isAutomationTaskProvider)).toEqual([
      'github',
      'gitlab',
      'linear',
      'jira'
    ])
  })

  it('rejects Plane as an automation source', () => {
    expect(TASK_PROVIDERS).toContain('plane')
    expect(isAutomationTaskProvider('plane')).toBe(false)
  })
})
