import { describe, expect, it } from 'vitest'
import { buildAutomationRunReportPrompt } from './automation-run-report-prompt'

describe('automation reporting instructions', () => {
  it('keeps the task and binds each reused-session turn to its own run', () => {
    const first = buildAutomationRunReportPrompt('Check the repository', {
      id: 'run-1',
      reportToken: 'token-1'
    })
    const next = buildAutomationRunReportPrompt('Check the repository', {
      id: 'run-2',
      reportToken: 'token-2'
    })
    expect(first).toContain('Check the repository')
    expect(first).toContain('--run-id run-1 --run-token token-1 --status failed')
    expect(first).toContain('--status needs-attention')
    expect(next).toContain('--run-id run-2 --run-token token-2')
    expect(next).not.toContain('token-1')
  })

  it('leaves legacy and unsafe identifiers out of generated shell commands', () => {
    expect(buildAutomationRunReportPrompt('Task', { id: 'legacy' })).toBe('Task')
    expect(
      buildAutomationRunReportPrompt('Task', { id: '$(echo bad)', reportToken: 'token' })
    ).toBe('Task')
  })
})
