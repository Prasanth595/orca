import type { AutomationRun } from './automations-types'
import { ORCA_CLI_POSIX_INVOCATION } from './orca-cli-shell-path'

export function buildAutomationRunReportPrompt(
  prompt: string,
  run: Pick<AutomationRun, 'id' | 'reportToken'>
): string {
  if (!run.reportToken || !/^[\w-]+$/.test(run.id) || !/^[\w-]+$/.test(run.reportToken)) {
    return prompt
  }
  const args = `automations report --run-id ${run.id} --run-token ${run.reportToken}`
  const powershellCli = '& $(if ($env:ORCA_CLI_COMMAND) { $env:ORCA_CLI_COMMAND } else { "orca" })'
  const instructions = (cli: string) =>
    `If you cannot achieve the task's goal, run:\n${cli} ${args} --status failed --message "Describe the failure"\nIf the prompt asks you to alert the user about a finding, run:\n${cli} ${args} --status needs-attention --message "Describe what needs attention"`
  return `${prompt}\n\nOrca automation run reporting:\nUse only the command for your execution host's shell, including its CLI path prefix.\nPOSIX shells (macOS, Linux, WSL, and POSIX SSH hosts):\n${instructions(ORCA_CLI_POSIX_INVOCATION)}\nWindows PowerShell:\n${instructions(powershellCli)}\nFor Windows cmd.exe, use "%ORCA_CLI_COMMAND%" when set, otherwise orca, with the same report arguments.\nReport only for this run, once. Reporting does not stop your terminal. If reporting is unsupported or fails, state that explicitly in your final response.`
}
