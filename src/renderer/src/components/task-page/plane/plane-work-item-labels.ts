import { translate } from '@/i18n/i18n'
import type { PlanePriority, PlaneStateGroup } from '../../../../../shared/plane-types'

export function getPlaneStateGroupLabel(group: PlaneStateGroup): string {
  switch (group) {
    case 'backlog':
      return translate('plane.stateGroup.backlog', 'Backlog')
    case 'unstarted':
      return translate('plane.stateGroup.unstarted', 'Unstarted')
    case 'started':
      return translate('plane.stateGroup.started', 'Started')
    case 'completed':
      return translate('plane.stateGroup.completed', 'Completed')
    case 'cancelled':
      return translate('plane.stateGroup.cancelled', 'Cancelled')
    case 'triage':
      return translate('plane.stateGroup.triage', 'Triage')
  }
}

export function getPlanePriorityLabel(priority: PlanePriority): string {
  switch (priority) {
    case 'urgent':
      return translate('plane.priority.urgent', 'Urgent')
    case 'high':
      return translate('plane.priority.high', 'High')
    case 'medium':
      return translate('plane.priority.medium', 'Medium')
    case 'low':
      return translate('plane.priority.low', 'Low')
    case 'none':
      return translate('plane.priority.none', 'No priority')
  }
}
