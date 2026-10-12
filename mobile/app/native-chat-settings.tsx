import { useEffect, useMemo, useState } from 'react'
import { loadHosts } from '../src/transport/host-store'
import type { HostProfile } from '../src/transport/types'
import { useFocusedSettingsHostClients } from '../src/transport/settings-host-client-connections'
import NativeChatSettingsScreen from '../src/settings/native-chat-settings-screen'
import { nativeVoiceSettingsOperations } from '../src/settings/native-voice-settings-operations'

// Same connected-client pattern as app/voice-settings.tsx: the Behaviour row
// here must read/write the SAME dictationMode setting via the SAME
// VoiceSettingsOperations, so the Voice screen and this screen never disagree.
export default function NativeChatSettingsRoute() {
  const [hosts, setHosts] = useState<HostProfile[]>([])
  useEffect(() => {
    void loadHosts().then(setHosts)
  }, [])
  const hostIds = useMemo(() => hosts.map((host) => host.id), [hosts])
  const { clients } = useFocusedSettingsHostClients(hostIds)
  const client = clients.find((entry) => entry.state === 'connected')?.client ?? null
  const voiceOperations = useMemo(
    () => (client ? nativeVoiceSettingsOperations(client) : null),
    [client]
  )
  return <NativeChatSettingsScreen voiceOperations={voiceOperations} />
}
