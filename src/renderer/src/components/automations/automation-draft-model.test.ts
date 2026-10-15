import { describe, expect, it } from 'vitest'
import type { AutomationDraft } from './AutomationEditorDialog'
import { isAutomationDraftChanged } from './automation-draft-model'

const draft: AutomationDraft = {
  name: 'Nightly',
  prompt: 'Run the tests',
  agentId: 'claude',
  extraAgentArgs: '',
  projectId: 'repo-1',
  workspaceMode: 'new_per_run',
  workspaceId: '',
  baseBranch: '',
  reuseSession: false,
  precheckCommand: '',
  precheckTimeoutSeconds: '60',
  preset: 'weekdays',
  time: '09:00',
  dayOfWeek: '1',
  customSchedule: '',
  savedSchedule: null,
  missedRunGraceMinutes: '',
  scheduleWarning: null
}

describe('isAutomationDraftChanged', () => {
  it('is false before the editor has opened a baseline', () => {
    expect(isAutomationDraftChanged(draft, null)).toBe(false)
  })

  it('is false for an untouched draft', () => {
    expect(isAutomationDraftChanged({ ...draft }, draft)).toBe(false)
  })

  it('is true once any field differs from the opened draft', () => {
    expect(isAutomationDraftChanged({ ...draft, prompt: 'Run the linter' }, draft)).toBe(true)
  })
})
