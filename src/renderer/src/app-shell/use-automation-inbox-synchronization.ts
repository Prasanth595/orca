import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { refreshAutomationInbox } from '@/lib/automation-inbox-sync'
import { getReachableRuntimeEnvironmentIds } from '@/hooks/ipc-events/runtime-environment-subscription-selection'

export function useAutomationInboxSynchronization(): void {
  const ready = useAppStore((state) => state.persistedUIReady)
  const profileId = useAppStore((state) => state.activeOrcaProfileId)
  const environments = useAppStore((state) =>
    state.persistedUIReady ? getReachableRuntimeEnvironmentIds(state).sort().join('\u0000') : ''
  )
  useEffect(() => {
    if (ready) {
      void refreshAutomationInbox({ kind: 'local' }).catch(console.warn)
    }
  }, [ready, profileId])
  useEffect(() => {
    if (!environments) {
      return
    }
    for (const environmentId of environments.split('\u0000')) {
      void refreshAutomationInbox({ kind: 'environment', environmentId }).catch(console.warn)
    }
  }, [environments, profileId])
}
