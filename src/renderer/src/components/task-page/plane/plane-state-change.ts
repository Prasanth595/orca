import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { getPlaneMutationErrorCopy } from '@/components/plane/plane-error-copy'
import { usePlaneHostLabel } from '@/components/plane/use-plane-host-label'
import {
  isPlaneRuntimeUpdateRequiredError,
  planeListStatesForTarget,
  planeUpdateStateForTarget
} from '@/runtime/runtime-plane-client'
import type { PlaneState, PlaneStateGroup, PlaneWorkItem } from '../../../../../shared/plane-types'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'
import { getPlaneStateGroupLabel } from './plane-work-item-labels'

/** Order of the picker sections; triage only appears when the project has triage states. */
const PICKER_GROUP_ORDER: readonly PlaneStateGroup[] = [
  'backlog',
  'unstarted',
  'started',
  'completed',
  'cancelled',
  'triage'
]

export type PlaneStateSection = { group: PlaneStateGroup; label: string; states: PlaneState[] }

export function groupPlaneStates(states: readonly PlaneState[]): PlaneStateSection[] {
  return PICKER_GROUP_ORDER.map((group) => ({
    group,
    label: getPlaneStateGroupLabel(group),
    states: states.filter((state) => state.group === group).sort((a, b) => a.sequence - b.sequence)
  })).filter((section) => section.states.length > 0)
}

export type PlaneStateChange = {
  sections: PlaneStateSection[] | null
  loadingStates: boolean
  pending: boolean
  loadStates: () => void
  changeState: (state: PlaneState) => void
}

/**
 * Applies a state optimistically, then settles on the host's answer: the updated item on
 * success, the previous item plus a toast on failure. A failed change is never retried.
 */
export function usePlaneStateChange(args: {
  item: PlaneWorkItem
  target: RuntimeClientTarget
  onItemChange: (item: PlaneWorkItem) => void
}): PlaneStateChange {
  const { item, target, onItemChange } = args
  const hostLabel = usePlaneHostLabel()
  const [states, setStates] = useState<PlaneState[] | null>(null)
  const [loadingStates, setLoadingStates] = useState(false)
  const [pending, setPending] = useState(false)
  // Why a ref: two quick picks can land before React re-renders the disabled trigger.
  const inFlightRef = useRef(false)

  const loadStates = (): void => {
    if (states || loadingStates) {
      return
    }
    setLoadingStates(true)
    planeListStatesForTarget(target, item.projectId, item.connectionId).then(
      (result) => {
        setLoadingStates(false)
        if (result.ok) {
          setStates(result.value)
        } else {
          toast.error(getPlaneMutationErrorCopy(result.error.kind, hostLabel))
        }
      },
      () => setLoadingStates(false)
    )
  }

  const changeState = (state: PlaneState): void => {
    if (inFlightRef.current || state.id === item.state?.id) {
      return
    }
    inFlightRef.current = true
    setPending(true)
    const previous = item
    onItemChange({ ...item, state })
    const settle = (next: PlaneWorkItem, errorCopy: string | null): void => {
      inFlightRef.current = false
      setPending(false)
      onItemChange(next)
      if (errorCopy) {
        toast.error(errorCopy)
      }
    }
    planeUpdateStateForTarget(target, {
      projectId: item.projectId,
      workItemId: item.id,
      connectionId: item.connectionId,
      stateId: state.id
    }).then(
      (result) =>
        result.ok
          ? settle(result.value, null)
          : settle(previous, getPlaneMutationErrorCopy(result.error.kind, hostLabel)),
      (error: unknown) =>
        settle(
          previous,
          getPlaneMutationErrorCopy(
            isPlaneRuntimeUpdateRequiredError(error) ? 'update_required' : 'runtime_error',
            hostLabel
          )
        )
    )
  }

  return {
    sections: states ? groupPlaneStates(states) : null,
    loadingStates,
    pending,
    loadStates,
    changeState
  }
}
