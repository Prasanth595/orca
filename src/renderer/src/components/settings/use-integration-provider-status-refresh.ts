import { useEffect, useMemo } from 'react'
import { defaultScopeHost } from '@/lib/default-creation-host'
import { getLocalPreflightContext, localPreflightContextKey } from '@/lib/local-preflight-context'
import { getEnvironmentRuntimeContextKey } from '@/lib/provider-runtime-context'
import { runtimeTargetEnvironmentId } from '@/runtime/runtime-client-target'
import { useAppStore } from '@/store'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'

/** Re-checks provider accounts on the Settings provider host, which it returns for the cards. */
export function useIntegrationProviderStatusRefresh(): RuntimeClientTarget {
  const settings = useAppStore((s) => s.settings)
  const preflightStatusChecked = useAppStore((s) => s.preflightStatusChecked)
  const preflightStatusContextKey = useAppStore((s) => s.preflightStatusContextKey)
  const linearStatusChecked = useAppStore((s) => s.linearStatusChecked)
  const linearStatusContextKey = useAppStore((s) => s.linearStatusContextKey)
  const jiraStatusChecked = useAppStore((s) => s.jiraStatusChecked)
  const jiraStatusContextKey = useAppStore((s) => s.jiraStatusContextKey)
  const planeStatusChecked = useAppStore((s) => s.planeStatusChecked)
  const planeStatusContextKey = useAppStore((s) => s.planeStatusContextKey)
  const checkLinearConnection = useAppStore((s) => s.checkLinearConnection)
  const checkJiraConnection = useAppStore((s) => s.checkJiraConnection)
  const checkPlaneConnection = useAppStore((s) => s.checkPlaneConnection)
  const refreshPreflightStatus = useAppStore((s) => s.refreshPreflightStatus)
  const expectedPreflightContextKey = useAppStore((s) =>
    localPreflightContextKey(getLocalPreflightContext(s))
  )
  const providerHost = useMemo(() => defaultScopeHost(settings), [settings])
  const providerRuntimeContextKey = getEnvironmentRuntimeContextKey(
    runtimeTargetEnvironmentId(providerHost)
  )
  const preflightStatusCurrent = preflightStatusContextKey === expectedPreflightContextKey
  const linearStatusCurrent = linearStatusContextKey === providerRuntimeContextKey
  const jiraStatusCurrent = jiraStatusContextKey === providerRuntimeContextKey
  const planeStatusCurrent = planeStatusContextKey === providerRuntimeContextKey

  useEffect(() => {
    if (!linearStatusCurrent || !linearStatusChecked) {
      void checkLinearConnection()
    }
    if (!jiraStatusCurrent || !jiraStatusChecked) {
      void checkJiraConnection()
    }
    if (!planeStatusCurrent || !planeStatusChecked) {
      void checkPlaneConnection(providerHost)
    }
    if (!preflightStatusCurrent || !preflightStatusChecked) {
      void refreshPreflightStatus()
    }
  }, [
    checkJiraConnection,
    checkLinearConnection,
    checkPlaneConnection,
    jiraStatusChecked,
    jiraStatusCurrent,
    jiraStatusContextKey,
    linearStatusChecked,
    linearStatusCurrent,
    linearStatusContextKey,
    planeStatusChecked,
    planeStatusCurrent,
    planeStatusContextKey,
    expectedPreflightContextKey,
    preflightStatusChecked,
    preflightStatusContextKey,
    preflightStatusCurrent,
    providerHost,
    providerRuntimeContextKey,
    refreshPreflightStatus
  ])
  return providerHost
}
