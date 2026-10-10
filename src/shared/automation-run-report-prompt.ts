import type { AutomationRun } from './automations-types'

export function buildAutomationRunReportPrompt(
  prompt: string,
  run: Pick<AutomationRun, 'id' | 'reportToken'>
): string {
  if (!run.reportToken || !/^[\w-]+$/.test(run.id) || !/^[\w-]+$/.test(run.reportToken)) {
    return prompt
  }
  const command = `orca automations report --run-id ${run.id} --run-token ${run.reportToken}`
  return `${prompt}\n\nOrca automation run reporting:\nIf you cannot achieve the task's goal, run:\n${command} --status failed --message "Describe the failure"\nIf the prompt asks you to alert the user about a finding, run:\n${command} --status needs-attention --message "Describe what needs attention"\nReport only for this run, once. Reporting does not stop your terminal. If reporting is unsupported or fails, state that explicitly in your final response.`
}
