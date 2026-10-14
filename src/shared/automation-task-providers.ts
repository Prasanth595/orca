import type { TaskProvider } from './task-providers'

// Why: providers opt in to automations explicitly, so a new task provider is
// never accepted as an automation source by accident.
export const AUTOMATION_TASK_PROVIDERS = [
  'github',
  'gitlab',
  'linear',
  'jira'
] as const satisfies readonly TaskProvider[]

export type AutomationTaskProvider = (typeof AUTOMATION_TASK_PROVIDERS)[number]

const AUTOMATION_TASK_PROVIDER_SET: ReadonlySet<unknown> = new Set(AUTOMATION_TASK_PROVIDERS)

export function isAutomationTaskProvider(value: unknown): value is AutomationTaskProvider {
  return AUTOMATION_TASK_PROVIDER_SET.has(value)
}
