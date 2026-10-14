import { translate } from '@/i18n/i18n'
import { defaultScopeHost } from '@/lib/default-creation-host'
import { useAppStore } from '@/store'
import { getLocalExecutionHostLabel } from '../../../../shared/execution-host'

/** The host that holds the Plane token and makes every Plane request. */
export function usePlaneHostLabel(): string {
  const settings = useAppStore((s) => s.settings)
  const runtimeEnvironments = useAppStore((s) => s.runtimeEnvironments)
  const target = defaultScopeHost(settings)
  if (target.kind !== 'environment') {
    return getLocalExecutionHostLabel()
  }
  return (
    runtimeEnvironments.find((environment) => environment.id === target.environmentId)?.name ??
    translate('plane.host.remoteServerFallback', 'the remote server')
  )
}
