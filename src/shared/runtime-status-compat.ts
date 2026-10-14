import { evaluateRuntimeCompat, type RuntimeCompatVerdict } from './protocol-compat'
import {
  MIN_COMPATIBLE_RUNTIME_SERVER_VERSION,
  REQUIRED_RUNTIME_SERVER_CAPABILITIES,
  RUNTIME_PROTOCOL_VERSION
} from './protocol-version'
import type { RuntimeStatus } from './runtime-types'

type RuntimeStatusCompatFields = Pick<
  RuntimeStatus,
  | 'runtimeProtocolVersion'
  | 'protocolVersion'
  | 'minCompatibleRuntimeClientVersion'
  | 'minCompatibleMobileVersion'
  | 'capabilities'
>

/** This client's verdict on a paired server's status reply; every client surface reads this one. */
export function evaluateRuntimeStatusCompat(
  status: Partial<RuntimeStatusCompatFields>,
  requiredServerCapabilities: readonly string[] = REQUIRED_RUNTIME_SERVER_CAPABILITIES
): RuntimeCompatVerdict {
  return evaluateRuntimeCompat({
    clientProtocolVersion: RUNTIME_PROTOCOL_VERSION,
    minCompatibleServerProtocolVersion: MIN_COMPATIBLE_RUNTIME_SERVER_VERSION,
    serverProtocolVersion: status.runtimeProtocolVersion ?? status.protocolVersion,
    serverMinCompatibleClientProtocolVersion:
      status.minCompatibleRuntimeClientVersion ?? status.minCompatibleMobileVersion,
    serverCapabilities: status.capabilities,
    requiredServerCapabilities
  })
}
