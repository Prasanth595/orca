import type { AutomationRun } from '../../../../shared/automations-types'

export function getAutomationRunContent(run: AutomationRun): string {
  const content = getSavedAutomationRunContent(run)
  if (!run.result) {
    return content
  }
  const label = run.result.status === 'failed' ? 'Failed' : 'Needs attention'
  return `${label}: ${run.result.message}\n\n${content}`
}

function getSavedAutomationRunContent(run: AutomationRun): string {
  const savedOutput = run.outputSnapshot?.content.trim()
  if (savedOutput) {
    return run.outputSnapshot?.content ?? savedOutput
  }
  if (run.precheckResult) {
    const output = [run.precheckResult.stderr.trim(), run.precheckResult.stdout.trim()]
      .filter(Boolean)
      .join('\n\n')
    if (output) {
      return output
    }
  }
  return run.error ?? run.usage?.unavailableMessage ?? 'No output content available.'
}
