import type { PlaneConnectArgs } from '../../../preload/api/plane-api'
import { PLANE_RUNTIME_CAPABILITY } from '../../../shared/plane-runtime-capabilities'
import type {
  PlaneConnectResult,
  PlaneConnectionStatus,
  PlaneProject,
  PlaneProjectScope,
  PlaneResult
} from '../../../shared/plane-types'
import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'
import { assertRuntimeEnvironmentCapability, callRuntimeRpc } from './runtime-rpc-client'

export type { PlaneConnectArgs } from '../../../preload/api/plane-api'

export const PLANE_RUNTIME_UPDATE_REQUIRED_MESSAGE =
  'Update the Orca server on this host to use Plane'

// Why: verification makes several sequential Plane requests (viewer, projects, API flavor).
const PLANE_CONNECT_TIMEOUT_MS = 60_000
const PLANE_READ_TIMEOUT_MS = 30_000
const PLANE_STATUS_TIMEOUT_MS = 15_000

type EnvironmentTarget = Extract<RuntimeClientTarget, { kind: 'environment' }>

async function callPlaneRpc<T>(
  target: EnvironmentTarget,
  method: string,
  params: unknown,
  timeoutMs: number
): Promise<T> {
  // Why: hosts without `plane.*` would answer "unknown method"; name the fix instead.
  await assertRuntimeEnvironmentCapability(
    target.environmentId,
    PLANE_RUNTIME_CAPABILITY,
    PLANE_RUNTIME_UPDATE_REQUIRED_MESSAGE
  )
  return callRuntimeRpc<T>(target, method, params, { timeoutMs })
}

export function isPlaneRuntimeUpdateRequiredError(error: unknown): boolean {
  return error instanceof Error && error.message === PLANE_RUNTIME_UPDATE_REQUIRED_MESSAGE
}

// Why: a client whose preload lacks the Plane bridge answers undefined; read that as disconnected.
function toPlaneConnectionStatus(
  value: PlaneConnectionStatus | null | undefined
): PlaneConnectionStatus {
  return value && typeof value === 'object' ? value : { connected: false }
}

export async function planeStatusForTarget(
  target: RuntimeClientTarget
): Promise<PlaneConnectionStatus> {
  return toPlaneConnectionStatus(
    target.kind === 'environment'
      ? await callPlaneRpc<PlaneConnectionStatus | undefined>(
          target,
          'plane.status',
          undefined,
          PLANE_STATUS_TIMEOUT_MS
        )
      : await window.api.plane.status()
  )
}

/** The token travels once, to the host that will store it; nothing returned carries it back. */
export async function planeConnectForTarget(
  target: RuntimeClientTarget,
  args: PlaneConnectArgs
): Promise<PlaneConnectResult> {
  return target.kind === 'environment'
    ? callPlaneRpc(target, 'plane.connect', args, PLANE_CONNECT_TIMEOUT_MS)
    : window.api.plane.connect(args)
}

export async function planeDisconnectForTarget(
  target: RuntimeClientTarget
): Promise<PlaneConnectionStatus> {
  return toPlaneConnectionStatus(
    target.kind === 'environment'
      ? await callPlaneRpc<PlaneConnectionStatus | undefined>(
          target,
          'plane.disconnect',
          undefined,
          PLANE_STATUS_TIMEOUT_MS
        )
      : await window.api.plane.disconnect()
  )
}

export async function planeSetProjectScopeForTarget(
  target: RuntimeClientTarget,
  scope: PlaneProjectScope
): Promise<PlaneResult<PlaneConnectionStatus>> {
  return target.kind === 'environment'
    ? callPlaneRpc(target, 'plane.setProjectScope', { scope }, PLANE_STATUS_TIMEOUT_MS)
    : window.api.plane.setProjectScope({ scope })
}

export async function planeListProjectsForTarget(
  target: RuntimeClientTarget,
  options: { refresh?: boolean } = {}
): Promise<PlaneResult<PlaneProject[]>> {
  const params = options.refresh ? { refresh: true } : undefined
  return target.kind === 'environment'
    ? callPlaneRpc(target, 'plane.listProjects', params, PLANE_READ_TIMEOUT_MS)
    : window.api.plane.listProjects(params)
}
