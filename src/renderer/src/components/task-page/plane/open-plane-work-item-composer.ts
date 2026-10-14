import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type { LinkedWorkItemSummary } from '@/lib/new-workspace'
import { buildPlaneWorkItemLinkedContext } from '@/lib/plane-work-item-linked-context'
import { buildPlaneWorkspaceSource } from '../../../../../shared/new-workspace/workspace-source'
import type { PlaneConnection, PlaneWorkItem } from '../../../../../shared/plane-types'
import type { TaskSourceContext } from '../../../../../shared/task-source-context'
import { getLinearIssueWorkspaceName } from '../../../../../shared/workspace-name'
import { bindTaskPagePlaneItemSourceContext } from './task-page-plane-item-source-context'

export type PlaneComposerItem = PlaneWorkItem & { descriptionText?: string }

export type PlaneComposerArgs = {
  item: PlaneComposerItem
  connection: PlaneConnection | null
  sourceContext: TaskSourceContext | null
  projectName?: string
  initialRepoId?: string
}

export type PlaneComposerData = {
  linkedWorkItem: LinkedWorkItemSummary
  taskSourceContext: TaskSourceContext
  initialRepoId?: string
  prefilledName: string
  telemetrySource: 'sidebar'
}

/** The new-workspace composer payload for a Plane work item, or null when it cannot be linked. */
export function buildPlaneWorkItemComposerData(args: PlaneComposerArgs): PlaneComposerData | null {
  const { item } = args
  const taskSourceContext = bindTaskPagePlaneItemSourceContext(args)
  if (!taskSourceContext) {
    return null
  }
  const linkedWorkItem: LinkedWorkItemSummary = {
    ...buildPlaneWorkspaceSource({ identifier: item.identifier, name: item.name, url: item.url }),
    linkedContext: buildPlaneWorkItemLinkedContext(item, { projectName: args.projectName })
  }
  return {
    linkedWorkItem,
    taskSourceContext,
    ...(args.initialRepoId ? { initialRepoId: args.initialRepoId } : {}),
    // Same `KEY-12-short-title` shape the other identifier-keyed providers seed.
    prefilledName: getLinearIssueWorkspaceName({ identifier: item.identifier, title: item.name }),
    telemetrySource: 'sidebar'
  }
}

export function openPlaneWorkItemComposer(
  args: PlaneComposerArgs & {
    openModal: (modal: 'new-workspace-composer', data: PlaneComposerData) => void
  }
): boolean {
  const data = buildPlaneWorkItemComposerData(args)
  if (!data) {
    // Why: the composer drops a link whose source context does not match; refuse instead.
    toast.error(
      translate(
        'plane.tasks.linkSourceUnavailable',
        'Couldn’t link this Plane work item. Reconnect Plane, then try again.'
      )
    )
    return false
  }
  args.openModal('new-workspace-composer', data)
  return true
}
