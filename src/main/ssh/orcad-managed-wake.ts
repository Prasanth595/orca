/**
 * Starting a managed orcad that is installed and activated but not running, most often one
 * that stopped itself after idling. A stopped server is just "not running": it is neither a
 * failure nor evidence about terminals, which the daemon owns and which outlive orcad.
 */
import { ORCAD_FENCE_OWNER_FILENAME } from './orcad-activation-fence-scope'
import type { ServeReadiness } from '../server/serve-readiness'
import { readOrcadActivationRecord } from './orcad-activation-record-store'
import { randomUUID } from 'node:crypto'
import {
  orcadActivationFenceExists,
  releaseOrcadActivationFence,
  withOrcadActivationLock
} from './orcad-activation-lock'
import { readBoundedOrcadRemoteRecord } from './orcad-remote-record-file'
import { orcadActivationFenceLockDir } from './orcad-activation-transaction'
import { joinRemotePath } from './ssh-remote-platform'

import { readOrcadActivationTransaction } from './orcad-activation-transaction-store'
import { OrcadActiveReadinessError } from './orcad-active-readiness'
import { managedOrcadSlot, probeManagedOrcadReadiness } from './orcad-managed-runtime-context'
import type { OrcadRemoteContext } from './orcad-remote-context'
import {
  ORCAD_RECOVERY_UNVERIFIABLE_CODE,
  recoverInterruptedOrcadActivation
} from './orcad-activation-recovery'
import {
  ensureOrcadSlotServing,
  orcadSlotDir,
  resolveOrcadSlotIdentity,
  slotLiveness,
  type OrcadSlotOptions
} from './orcad-recovery-slot'

export type OrcadManagedWake =
  | { outcome: 'serving' | 'not-activated' | 'unverifiable' }
  /** An update, rollback or recovery holds the host; it owns which slot serves. */
  | { outcome: 'fenced' }
  | { outcome: 'started'; readiness: ServeReadiness }
  /** An abandoned update or rollback that recovery could not finish without an operator. */
  | { outcome: 'recovery-refused'; reason: string }

/** Launches the active slot only on proven exit; a live or unprovable process is left alone. */
export function wakeStoppedManagedOrcad(
  options: OrcadSlotOptions,
  onStarting: () => void = () => {}
): Promise<OrcadManagedWake> {
  const host = wakeHostKey(options)
  // Registered before any remote step: a wake on a dropped connection settles first, so a
  // reconnected wake never races it to the fence and finds its fence unexplained.
  const prior = runningWakes.get(host)
  const wake = (async (): Promise<OrcadManagedWake> => {
    await prior?.catch(() => {})
    return wakeAfterPrior(options, host, onStarting)
  })()
  runningWakes.set(host, wake)
  void wake
    .catch(() => {})
    .finally(() => {
      if (runningWakes.get(host) === wake) {
        runningWakes.delete(host)
      }
    })
  return wake
}

/**
 * The readiness of a recorded-active slot this call started, or null when there was nothing to start:
 * not activated, already serving, unprovable, or fenced by another run. Callers that are about to use
 * the slot's port use this so a server that idled out is woken instead of answering as a wrong server.
 */
export async function startStoppedActiveOrcad(
  options: OrcadSlotOptions
): Promise<ServeReadiness | null> {
  const wake = await wakeStoppedManagedOrcad(options)
  return wake.outcome === 'started' ? wake.readiness : null
}

/**
 * A readiness answer, and whether this call had to start the slot to get it. Callers need the flag
 * because a started slot may bind another port than the forward they already reuse.
 */
export type OrcadProbedReadiness = { readiness: ServeReadiness; startedServer: boolean }

/**
 * The deployed version's readiness, starting the slot when it is proven exited. A deploy that finds
 * this version already active launches nothing, so a server that stopped since then reports itself as
 * exited: that is a server to start, not a failed update.
 */
export async function probeOrWakeStoppedOrcadReadiness(args: {
  context: OrcadRemoteContext
  localOrcadDir: string
  fullVersion: string
  port: number
  signal?: AbortSignal
}): Promise<OrcadProbedReadiness> {
  try {
    const readiness = await probeManagedOrcadReadiness(
      args.context,
      args.localOrcadDir,
      args.fullVersion,
      args.signal
    )
    return { readiness, startedServer: false }
  } catch (error) {
    const readiness =
      error instanceof OrcadActiveReadinessError && error.verdict === 'exited'
        ? await startStoppedActiveOrcad(managedOrcadSlot(args.context, args.port, args.signal))
        : null
    if (!readiness) {
      throw error
    }
    return { readiness, startedServer: true }
  }
}

async function wakeAfterPrior(
  options: OrcadSlotOptions,
  host: string,
  onStarting: () => void
): Promise<OrcadManagedWake> {
  const before = await readOrcadActivationRecord(options)
  if (!before.active) {
    return { outcome: 'not-activated' }
  }
  const liveness = await slotLiveness(options, orcadSlotDir(options, before.active))
  if (liveness !== 'DEAD') {
    return { outcome: liveness === 'LIVE' ? 'serving' : 'unverifiable' }
  }
  if (!(await orcadActivationFenceExists(options))) {
    // The fence this client left is gone by some other route; any later one belongs to another run.
    interruptedWakes.delete(host)
  } else if (!(await releaseOwnInterruptedWakeFence(options, host))) {
    const recovered = await recoverAbandonedFence(options, onStarting)
    if (recovered) {
      return recovered
    }
  }
  // Claimed before the fence and written by the command that creates it: a drop at any point
  // after the fence lands leaves one this client can prove its own. Kept on any failure, since a
  // release over a dropped connection fails quietly; the next wake re-proves it on the host.
  const token = randomUUID()
  interruptedWakes.set(host, token)
  const result = await withOrcadActivationLock(
    options,
    async (): Promise<OrcadManagedWake> => {
      // Re-read under the fence: another client may have activated or started a slot meanwhile.
      const active = (await readOrcadActivationRecord(options)).active
      if (!active) {
        return { outcome: 'not-activated' }
      }
      const identity = await resolveOrcadSlotIdentity(options, active)
      onStarting()
      return { outcome: 'started', readiness: await ensureOrcadSlotServing(options, identity) }
    },
    (): OrcadManagedWake => ({ outcome: 'fenced' }),
    token
  )
  // Released, or never acquired.
  if (interruptedWakes.get(host) === token) {
    interruptedWakes.delete(host)
  }
  return result
}

/**
 * An update or rollback whose client quit or crashed leaves a journal nobody finishes, so a later
 * reboot would serve nothing until a manual Recover (P1-A). Recovery takes only a stale,
 * previous-boot or exited-own fence; a run still working answers busy. Null: the fence is gone.
 */
async function recoverAbandonedFence(
  options: OrcadSlotOptions,
  onStarting: () => void
): Promise<OrcadManagedWake | null> {
  const recovery = await recoverInterruptedOrcadActivation(options)
  switch (recovery.outcome) {
    case 'none':
      return null
    case 'pending':
      return { outcome: 'fenced' }
    case 'refused':
      // A step the host did not answer is retried on the fence recheck, like a busy fence.
      return recovery.code === ORCAD_RECOVERY_UNVERIFIABLE_CODE
        ? { outcome: 'fenced' }
        : { outcome: 'recovery-refused', reason: recovery.reason }
    case 'recovered':
      if (!recovery.readiness) {
        return { outcome: 'not-activated' }
      }
      onStarting()
      return { outcome: 'started', readiness: recovery.readiness }
  }
}

const runningWakes = new Map<string, Promise<OrcadManagedWake>>()

// The owner token of a fence this client's own wake may have left when its connection dropped.
const interruptedWakes = new Map<string, string>()

function wakeOwnerPath(options: OrcadSlotOptions): string {
  return joinRemotePath(
    options.host,
    orcadActivationFenceLockDir(options.host, options.remoteHome),
    ORCAD_FENCE_OWNER_FILENAME
  )
}

function wakeHostKey(options: OrcadSlotOptions): string {
  return `${options.conn.getTarget().id}\0${options.remoteHome}`
}

/**
 * Releases only the fence carrying this client's own interrupted wake token and no journal; the
 * slot was just proven exited and orcad's instance lock bars a double start.
 */
async function releaseOwnInterruptedWakeFence(
  options: OrcadSlotOptions,
  host: string
): Promise<boolean> {
  const token = interruptedWakes.get(host)
  if (!token || (await readOrcadActivationTransaction(options))) {
    return false
  }
  // Only a fence carrying this process's own token: a fresh fence another client took has none yet.
  const owner = await readBoundedOrcadRemoteRecord(options, wakeOwnerPath(options), 64)
  if (owner.state !== 'present' || owner.raw.trim() !== token) {
    interruptedWakes.delete(host)
    return false
  }
  await releaseOrcadActivationFence(options, token)
  interruptedWakes.delete(host)
  return true
}
