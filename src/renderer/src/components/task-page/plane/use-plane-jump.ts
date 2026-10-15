import { useState } from 'react'
import { getPlaneErrorCopy, type PlaneErrorKind } from '@/components/plane/plane-error-copy'
import { usePlaneHostLabel } from '@/components/plane/use-plane-host-label'
import { translate } from '@/i18n/i18n'
import { planeLookupWorkItemForTarget } from '@/runtime/runtime-plane-client'
import type { PlaneWorkItem } from '../../../../../shared/plane-types'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'

type LookupOutcome = { item: PlaneWorkItem } | { error: PlaneErrorKind }

// Why one workspace at a time: the first hit ends the search, so an ID costs as few requests
// as the workspaces it takes to find it.
async function lookUpAcross(
  target: RuntimeClientTarget,
  identifier: string,
  connectionIds: readonly string[]
): Promise<LookupOutcome> {
  let failure: PlaneErrorKind = 'not_found'
  for (const connectionId of connectionIds) {
    try {
      const result = await planeLookupWorkItemForTarget(target, identifier, connectionId)
      if (result.ok) {
        return { item: result.value }
      }
      failure = failure === 'not_found' ? result.error.kind : failure
    } catch {
      failure = failure === 'not_found' ? 'runtime_error' : failure
    }
  }
  return { error: failure }
}

/** Opens a typed ID like WEB-12: from the loaded list when present, else by asking each workspace. */
export function usePlaneJump(
  target: RuntimeClientTarget,
  connectionIds: readonly string[],
  items: readonly PlaneWorkItem[],
  onFound: (item: PlaneWorkItem) => void
): { jump: (identifier: string) => void; jumpError: string | null; clearJumpError: () => void } {
  const [jumpError, setJumpError] = useState<string | null>(null)
  const hostLabel = usePlaneHostLabel()
  const jump = (identifier: string): void => {
    setJumpError(null)
    const loaded = items.find((item) => item.identifier === identifier)
    if (loaded) {
      onFound(loaded)
      return
    }
    void lookUpAcross(target, identifier, connectionIds).then((outcome) => {
      if ('item' in outcome) {
        onFound(outcome.item)
      } else if (outcome.error !== 'not_found') {
        setJumpError(getPlaneErrorCopy(outcome.error, hostLabel))
      } else {
        setJumpError(
          connectionIds.length > 1
            ? translate(
                'plane.tasks.idNotFoundAnywhere',
                '{{identifier}} was not found in any connected workspace.',
                { identifier }
              )
            : translate(
                'plane.tasks.idNotFound',
                '{{identifier}} was not found in this workspace.',
                {
                  identifier
                }
              )
        )
      }
    })
  }
  return { jump, jumpError, clearJumpError: () => setJumpError(null) }
}
