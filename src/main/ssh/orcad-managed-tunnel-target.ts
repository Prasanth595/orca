/** Opens a managed tunnel at the port orcad bound and keeps it only if orcad is what answers. */
import {
  getRuntimeSshAccess,
  type KnownRuntimeEnvironment
} from '../../shared/runtime-environments'
import {
  orcadBoundPort,
  resolveManagedOrcadTunnelPort,
  type OrcadTunnelPortInput
} from './orcad-managed-bound-port'
import {
  OrcadManagedIdentityError,
  verifyManagedOrcadTunnelIdentity,
  type OrcadTunnelIdentity
} from './orcad-managed-tunnel-identity'
import { managedOrcadSlot } from './orcad-managed-runtime-context'
import { startStoppedActiveOrcad } from './orcad-managed-wake'
import { resolveOrcadRemoteContext } from './orcad-remote-context'
import type { SshConnection } from './ssh-connection'
import type { PortForwardEntry, SshPortForwardManager } from './ssh-port-forward'

export type OrcadManagedTunnelTargeting = {
  resolveRemotePort: (input: OrcadTunnelPortInput) => Promise<number>
  /** Checks the runtime the environment's pairing endpoint (the tunnel's local port) reaches. */
  verifyIdentity: (environment: KnownRuntimeEnvironment) => Promise<OrcadTunnelIdentity>
  /**
   * Starts the managed server when its process is proven exited, and answers the port it landed on.
   * Null when there was nothing to start, so the caller keeps the port it already had.
   */
  startStoppedServer?: (input: OrcadTunnelPortInput) => Promise<number | null>
}

export const MANAGED_ORCAD_TUNNEL_TARGETING: OrcadManagedTunnelTargeting = {
  resolveRemotePort: resolveManagedOrcadTunnelPort,
  verifyIdentity: verifyManagedOrcadTunnelIdentity,
  startStoppedServer: startStoppedManagedOrcadServer
}

/**
 * Why a failed identity check is not the end: the recorded port may be held by another runtime (a
 * foreign answer) or left free (nothing answers) precisely because this server stopped, and a stopped
 * server is woken rather than reported as a stranger or as silence. Starting it moves orcad to a free
 * port, which the caller then follows; anything the wake could not prove leaves the port as it was.
 */
async function startStoppedManagedOrcadServer(input: OrcadTunnelPortInput): Promise<number | null> {
  try {
    const access = getRuntimeSshAccess(input.environment)
    if (!access) {
      return null
    }
    const context = await resolveOrcadRemoteContext(input.target, input.connection)
    const readiness = await startStoppedActiveOrcad(managedOrcadSlot(context, access.remotePort))
    return readiness ? orcadBoundPort(readiness) : null
  } catch (error) {
    console.warn(
      '[ssh] Could not start the managed Orca server after a failed identity check:',
      error
    )
    return null
  }
}

/** Test default: the persisted port, and no identity round trip. */
export const PERSISTED_PORT_TARGETING: OrcadManagedTunnelTargeting = {
  resolveRemotePort: async ({ environment }) => getRuntimeSshAccess(environment)?.remotePort ?? 0,
  verifyIdentity: async () => ({ verdict: 'verified' })
}

export type VerifiedOrcadForwardArgs = {
  targetId: string
  connection: SshConnection
  forwards: SshPortForwardManager
  /** 0 picks a free local port. */
  localPort: number
  label: string
  remotePort: number
  /** Defaults to the same port, so a foreign answer fails at once. */
  rereadRemotePort?: () => Promise<number>
  /** Defaults to trusting the forward, for callers that verify on their own. */
  verify?: (localPort: number) => Promise<OrcadTunnelIdentity>
  stillCurrent: () => boolean
}

export type OrcadTunnelStartChecks = Pick<
  VerifiedOrcadForwardArgs,
  'rereadRemotePort' | 'verify'
> & {
  /** The persisted launch port, when the forward targets a port orcad fell back to. */
  preferredPort?: number
}

/** The manager's targeting, bound to one environment's tunnel, with the port it reads now. */
export async function environmentForwardChecks(
  targeting: OrcadManagedTunnelTargeting,
  input: OrcadTunnelPortInput
): Promise<Required<Pick<VerifiedOrcadForwardArgs, 'remotePort' | 'rereadRemotePort' | 'verify'>>> {
  return {
    remotePort: await targeting.resolveRemotePort(input),
    rereadRemotePort: async () => {
      // Why before the re-read: either failure at this port can mean this server stopped — another
      // runtime took the port it left behind, or nobody answers because it left the port free — so
      // start it and follow where it lands.
      const started = await targeting.startStoppedServer?.(input)
      return started ?? (await targeting.resolveRemotePort(input))
    },
    verify: () => targeting.verifyIdentity(input.environment)
  }
}

/**
 * Null when `stillCurrent` turned false mid-setup; the forward is already removed then.
 *
 * Neither failure verdict ends the attempt on its own: the recorded port may be held by another
 * runtime (a foreign answer) or free because this server stopped (nothing answers), and `rereadPort`
 * starts the server on a proven exit and answers the port it lands on. A foreign answer follows that
 * port once and throws if it did not move; an answer that says nothing keeps the forward it has,
 * because a server that is down or still starting is not a wrong server.
 */
export async function forwardToVerifiedOrcad(
  args: VerifiedOrcadForwardArgs
): Promise<PortForwardEntry | null> {
  let remotePort = args.remotePort
  for (let attempt = 0; ; attempt++) {
    const forward = await addCurrentForward(args, remotePort)
    if (!forward) {
      return null
    }
    const identity = args.verify
      ? await args.verify(forward.localPort)
      : ({ verdict: 'verified' } as const)
    if (!args.stillCurrent()) {
      await args.forwards.removeForwardAndWait(forward.id)
      return null
    }
    if (identity.verdict === 'verified') {
      return forward
    }
    const reread =
      attempt === 0 && args.rereadRemotePort ? await args.rereadRemotePort() : remotePort
    if (!args.stillCurrent()) {
      await args.forwards.removeForwardAndWait(forward.id)
      return null
    }
    if (identity.verdict === 'unreachable') {
      if (reread === remotePort) {
        console.warn(
          `[ssh] Managed Orca server did not answer through its tunnel: ${identity.detail}`
        )
        return forward
      }
      await args.forwards.removeForwardAndWait(forward.id)
      remotePort = reread
      continue
    }
    await args.forwards.removeForwardAndWait(forward.id)
    if (reread === remotePort) {
      throw new OrcadManagedIdentityError(remotePort, identity.detail)
    }
    remotePort = reread
  }
}

async function addCurrentForward(
  args: VerifiedOrcadForwardArgs,
  remotePort: number
): Promise<PortForwardEntry | null> {
  const forward = await args.forwards.addForward(
    args.targetId,
    args.connection,
    args.localPort,
    '127.0.0.1',
    remotePort,
    args.label
  )
  if (args.localPort !== 0 && forward.localPort !== args.localPort) {
    await args.forwards.removeForwardAndWait(forward.id)
    throw new Error('Managed Orca tunnel bound an unexpected local port.')
  }
  if (!args.stillCurrent()) {
    await args.forwards.removeForwardAndWait(forward.id)
    return null
  }
  return forward
}
