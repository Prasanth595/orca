import { useEffect, useRef, useState } from 'react'
import { shouldClearNativeChatWorkingSuppression } from './native-chat-working-suppression'

export function useNativeChatWorkingSuppression(
  liveWorking: boolean,
  hookWorkingEpoch: number | null
) {
  const [workingInterrupted, setWorkingInterrupted] = useState(false)
  const previousWorkingEpochRef = useRef<number | null>(null)
  useEffect(() => {
    if (
      shouldClearNativeChatWorkingSuppression({
        working: liveWorking,
        interrupted: workingInterrupted,
        workingEpoch: hookWorkingEpoch,
        previousWorkingEpoch: previousWorkingEpochRef.current
      })
    ) {
      setWorkingInterrupted(false)
    }
    if (liveWorking && hookWorkingEpoch != null) {
      previousWorkingEpochRef.current = hookWorkingEpoch
    }
    if (!liveWorking) {
      previousWorkingEpochRef.current = null
    }
  }, [liveWorking, workingInterrupted, hookWorkingEpoch])
  return [workingInterrupted, setWorkingInterrupted] as const
}
