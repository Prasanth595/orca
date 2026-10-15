import { evaluateRuntimeCompat, type RuntimeCompatVerdict } from './protocol-compat'
import { MIN_COMPATIBLE_RUNTIME_SERVER_VERSION, RUNTIME_PROTOCOL_VERSION } from './protocol-version'
import type { RuntimeStatus } from './runtime-types'

type RuntimeStatusCompatFields = Pick<
  RuntimeStatus,
  | 'runtimeProtocolVersion'
  | 'protocolVersion'
  | 'minCompatibleRuntimeClientVersion'
  | 'minCompatibleMobileVersion'
>

/** This client's verdict on a paired server's status reply; the registry and host surfaces read this one. */
export function evaluateRuntimeStatusCompat(
  status: Partial<RuntimeStatusCompatFields>
): RuntimeCompatVerdict {
  return evaluateRuntimeCompat({
    clientProtocolVersion: RUNTIME_PROTOCOL_VERSION,
    minCompatibleServerProtocolVersion: MIN_COMPATIBLE_RUNTIME_SERVER_VERSION,
    serverProtocolVersion: status.runtimeProtocolVersion ?? status.protocolVersion,
    serverMinCompatibleClientProtocolVersion:
      status.minCompatibleRuntimeClientVersion ?? status.minCompatibleMobileVersion
  })
}
