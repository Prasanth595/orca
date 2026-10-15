import { createContext, useContext, useMemo } from 'react'
import { translate } from '@/i18n/i18n'
import { getEnvironmentRuntimeContextKey } from '@/lib/provider-runtime-context'
import { runtimeTargetEnvironmentId } from '@/runtime/runtime-client-target'
import { useAppStore } from '@/store'
import { getLocalExecutionHostLabel } from '../../../../shared/execution-host'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'

/** The host that holds the Plane token and makes every Plane request, chosen once per page. */
export type PlaneHostScope = {
  target: RuntimeClientTarget
  /** Which host and runtime session the Plane slice state belongs to. */
  contextKey: string
  label: string
}

const PlaneHostScopeContext = createContext<PlaneHostScope | null>(null)

export const PlaneHostScopeProvider = PlaneHostScopeContext.Provider

/** The scope of the host a page or settings card resolved; its children read it from context. */
export function useResolvedPlaneHostScope(target: RuntimeClientTarget): PlaneHostScope {
  const environmentId = runtimeTargetEnvironmentId(target)
  const environmentName = useAppStore((s) =>
    environmentId
      ? (s.runtimeEnvironments.find((environment) => environment.id === environmentId)?.name ??
        null)
      : null
  )
  // Why every render: the key carries the runtime session generation, which moves outside the store.
  const contextKey = getEnvironmentRuntimeContextKey(environmentId)
  return useMemo(
    () => ({
      target: environmentId ? { kind: 'environment', environmentId } : { kind: 'local' },
      contextKey,
      label: !environmentId
        ? getLocalExecutionHostLabel()
        : (environmentName ?? translate('plane.host.remoteServerFallback', 'the remote server'))
    }),
    [contextKey, environmentId, environmentName]
  )
}

export function usePlaneHostScope(): PlaneHostScope {
  const scope = useContext(PlaneHostScopeContext)
  if (!scope) {
    throw new Error('usePlaneHostScope must be used inside a PlaneHostScopeProvider')
  }
  return scope
}
