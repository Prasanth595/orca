import type { WorkspaceAttachment } from '../../../shared/worktree/types'
import {
  WORKTREE_LINKED_ITEMS_RUNTIME_CAPABILITY,
  WORKTREE_LINKED_ITEMS_DELTA_RUNTIME_CAPABILITY
} from '../../../shared/workspace-attachment-capabilities'
import { assertRuntimeEnvironmentCapability } from './runtime-rpc-client'
import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'
import { translate } from '@/i18n/i18n'
import { PLANE_LINKED_WORK_ITEM_RUNTIME_CAPABILITY } from '../../../shared/plane-runtime-capabilities'

type ProviderTagged = { provider?: string } | null | undefined

export type PlaneLinkCarriers = {
  linkedWorkItem?: ProviderTagged
  linkedTask?: ProviderTagged
  linkedTaskSourceContext?: ProviderTagged
  linkedItems?: readonly ProviderTagged[]
  linkedItemsBase?: readonly ProviderTagged[]
}

/**
 * Why: hosts without Plane support reject a whole worktree or folder write whose link names a
 * provider they do not know, so ask for an update before sending one.
 */
export async function assertPlaneLinkRuntimeCapability(
  target: RuntimeClientTarget,
  links: PlaneLinkCarriers
): Promise<void> {
  const carriers = [
    links.linkedWorkItem,
    links.linkedTask,
    links.linkedTaskSourceContext,
    ...(links.linkedItems ?? []),
    ...(links.linkedItemsBase ?? [])
  ]
  if (target.kind !== 'environment' || !carriers.some((item) => item?.provider === 'plane')) {
    return
  }
  await assertRuntimeEnvironmentCapability(
    target.environmentId,
    PLANE_LINKED_WORK_ITEM_RUNTIME_CAPABILITY,
    translate('plane.link.updateRequired', 'Update the remote runtime to link Plane work items')
  )
}

export async function assertWorkspaceAttachmentWriteCapability(
  target: RuntimeClientTarget,
  updates: { linkedItems?: WorkspaceAttachment[]; linkedItemsBase?: WorkspaceAttachment[] }
): Promise<void> {
  if (target.kind !== 'environment') {
    return
  }
  await assertPlaneLinkRuntimeCapability(target, updates)
  if (updates.linkedItemsBase !== undefined) {
    await assertRuntimeEnvironmentCapability(
      target.environmentId,
      WORKTREE_LINKED_ITEMS_DELTA_RUNTIME_CAPABILITY,
      translate(
        'workspace.attachments.updateRuntimeSafely',
        'Update the remote runtime to safely change workspace links'
      )
    )
  }
  if (updates.linkedItems !== undefined) {
    await assertRuntimeEnvironmentCapability(
      target.environmentId,
      WORKTREE_LINKED_ITEMS_RUNTIME_CAPABILITY,
      translate(
        'workspace.attachments.updateRuntime',
        'Update the remote runtime to change workspace links'
      )
    )
  }
}
