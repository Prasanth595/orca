import React from 'react'
import { Server, ServerOff } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { toRuntimeExecutionHostId } from '../../../../shared/execution-host'
import { getHostDisplayLabelOverrides } from '../../../../shared/host-setting-overrides'
import {
  isDisconnectedRuntimeHostState,
  runtimeHostConnectionStateForEntry
} from '@/runtime/runtime-host-connection-state'
import { useAppStore } from '@/store'

export type RuntimeHostIndicatorState = {
  runtimeHostLabel: string | null
  isRuntimeDisconnected: boolean
}

export function useRuntimeHostIndicatorState(
  runtimeOwnerEnvironmentId: string | null
): RuntimeHostIndicatorState {
  const settings = useAppStore((s) => s.settings)
  const runtimeEnvironmentName = useAppStore((s) =>
    runtimeOwnerEnvironmentId
      ? (s.runtimeEnvironments.find((environment) => environment.id === runtimeOwnerEnvironmentId)
          ?.name ?? null)
      : null
  )
  // Why the shared derivation, not raw truthiness: an absent entry means "not probed yet",
  // which is not the same verdict as a probe that came back unreachable.
  const isRuntimeDisconnected = useAppStore((s) => {
    if (!runtimeOwnerEnvironmentId) {
      return false
    }
    return isDisconnectedRuntimeHostState(
      runtimeHostConnectionStateForEntry(
        s.runtimeStatusByEnvironmentId.get(runtimeOwnerEnvironmentId)
      )
    )
  })
  const runtimeHostId = runtimeOwnerEnvironmentId
    ? toRuntimeExecutionHostId(runtimeOwnerEnvironmentId)
    : null
  const runtimeHostLabel = runtimeHostId
    ? (getHostDisplayLabelOverrides(settings).get(runtimeHostId) ?? runtimeEnvironmentName)
    : null
  return { runtimeHostLabel, isRuntimeDisconnected }
}

export function RuntimeHostIndicator({
  runtimeHostLabel,
  isRuntimeDisconnected
}: RuntimeHostIndicatorState): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="shrink-0 inline-flex items-center">
          {isRuntimeDisconnected ? (
            // Passive by design: runtime ("Orca server") hosts have no
            // renderer-reachable connect API, unlike the SSH glyph, which is
            // a control. Don't "fix" the inconsistency by wiring one up.
            <ServerOff className="size-3 text-destructive" />
          ) : (
            <Server className="size-3 text-muted-foreground" />
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {isRuntimeDisconnected
          ? runtimeHostLabel
            ? translate(
                'auto.components.sidebar.WorktreeCard.runtimeHostDisconnectedNamed',
                '{{hostName}} disconnected',
                { hostName: runtimeHostLabel }
              )
            : translate(
                'auto.components.sidebar.WorktreeCard.runtimeHostDisconnected',
                'Server disconnected'
              )
          : runtimeHostLabel
            ? translate(
                'auto.components.sidebar.WorktreeCard.runtimeHostProjectNamed',
                'Project on {{hostName}}',
                { hostName: runtimeHostLabel }
              )
            : translate(
                'auto.components.sidebar.WorktreeCard.runtimeHostProject',
                'Project on Orca server'
              )}
      </TooltipContent>
    </Tooltip>
  )
}
