import type {
  AutomationCreateInput,
  AutomationUpdateInput,
  AutomationWorkspaceMode
} from '../../shared/automations-types'
import type { AutomationDestination } from '../../shared/automation-owner-precondition'

export type RuntimeAutomationCreateInput = Omit<
  AutomationCreateInput,
  'projectId' | 'workspaceId' | 'workspaceMode' | 'timezone'
> & {
  repo?: string
  workspace?: string
  workspaceMode?: AutomationWorkspaceMode
  timezone?: string
  destination?: AutomationDestination
}

export type RuntimeAutomationUpdateInput = Omit<
  AutomationUpdateInput,
  'projectId' | 'workspaceId'
> & {
  repo?: string
  workspace?: string
}
