import type { TaskSourceContext } from '../../../shared/task-source-context'

export const TASK_SOURCE_PROVIDER_LABEL: Record<TaskSourceContext['provider'], string> = {
  local: 'Local',
  github: 'GitHub',
  gitlab: 'GitLab',
  linear: 'Linear',
  jira: 'Jira'
}
