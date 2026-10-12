import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ExecCommandModule from './ssh-relay-exec-command'
import type * as InstallLock from './ssh-relay-install-lock'

vi.mock('./ssh-relay-exec-command', async (importOriginal) => ({
  ...(await importOriginal<typeof ExecCommandModule>()),
  execCommand: vi.fn()
}))
vi.mock('./ssh-connection-utils', () => ({ shellEscape: (s: string) => `'${s}'` }))
vi.mock('./ssh-relay-install-lock', async (importOriginal) => ({
  ...(await importOriginal<typeof InstallLock>()),
  acquireInstallLock: vi.fn()
}))
// Why partial: managedOrcadSlot stays real, so the woke slot matches the one this file builds.
vi.mock('./orcad-managed-runtime-context', async (importOriginal) => ({
  ...(await importOriginal<typeof RuntimeContextModule>()),
  probeManagedOrcadReadiness: vi.fn()
}))

import { execCommand } from './ssh-relay-exec-command'
import { acquireInstallLock, RemoteInstallLockBusyError } from './ssh-relay-install-lock'
import type * as RuntimeContextModule from './orcad-managed-runtime-context'
import { probeManagedOrcadReadiness } from './orcad-managed-runtime-context'
import { OrcadActiveReadinessError } from './orcad-active-readiness'
import type { OrcadRemoteContext } from './orcad-remote-context'
import type { ServeReadiness } from '../server/serve-readiness'
import {
  probeOrWakeStoppedOrcadReadiness,
  startStoppedActiveOrcad,
  wakeStoppedManagedOrcad
} from './orcad-managed-wake'
import { getRemoteHostPlatform } from './ssh-remote-platform'
import type { OrcadHostTransport } from './orcad-host-transport'
import { FakeOrcadHost, OLD } from './orcad-activation-host-test-harness'
import {
  ORCAD_E2E_IDLE_TIMEOUT_ENV,
  ORCAD_MANAGED_ACTIVATION_ROOT_ENV
} from '../../shared/orcad-idle-exit'

let host = new FakeOrcadHost()

const slot = {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: execCommand is mocked; the wake reads only the target id.
  conn: { getTarget: () => ({ id: 'ssh-1' }) } as unknown as OrcadHostTransport,
  host: getRemoteHostPlatform('linux-x64'),
  remoteHome: '/home/u',
  nodePath: '/usr/bin/node',
  userDataDir: '/home/u/.orca',
  bindHost: '127.0.0.1',
  port: 7777,
  readinessTimeoutMs: 50,
  sleep: async () => {}
}

function launches(): string[] {
  return host.commands.filter((command) => command.includes('nohup'))
}

/** The slot's process exited on its own, as an idle stop leaves it. */
function stoppedHost(): FakeOrcadHost {
  const stopped = FakeOrcadHost.deployedOld()
  stopped.alive.clear()
  return stopped
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(execCommand).mockImplementation(async (_conn, command) => host.exec(command))
  vi.mocked(acquireInstallLock).mockImplementation(async (_conn, root, _host, options) => {
    // A recovery takeover answers busy on a fence another run still holds.
    if (!host.acquireFence(options)) {
      throw new RemoteInstallLockBusyError(root, 0)
    }
    // The real lock writes the owner token in the same command that creates it.
    host.wakeOwner = options?.owner?.token ?? null
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('wakeStoppedManagedOrcad', () => {
  it('starts a stopped active slot as a managed launch and releases the fence', async () => {
    host = stoppedHost()

    const wake = await wakeStoppedManagedOrcad(slot)

    expect(wake.outcome).toBe('started')
    expect([...host.alive]).toEqual([OLD])
    expect(host.fence).toBe(false)
    expect(launches()).toHaveLength(1)
    expect(launches()[0]).toContain(
      `${ORCAD_MANAGED_ACTIVATION_ROOT_ENV}='/home/u/.orca-remote/.orcad-activation-transaction'`
    )
    expect(launches()[0]).not.toContain(ORCAD_E2E_IDLE_TIMEOUT_ENV)
  })

  it('forwards the test-only idle timeout to the server it starts', async () => {
    vi.stubEnv(ORCAD_E2E_IDLE_TIMEOUT_ENV, '3000')
    host = stoppedHost()

    await wakeStoppedManagedOrcad(slot)

    expect(launches()[0]).toContain(`${ORCAD_E2E_IDLE_TIMEOUT_ENV}='3000'`)
  })

  it('leaves a running server alone', async () => {
    host = FakeOrcadHost.deployedOld()

    expect(await wakeStoppedManagedOrcad(slot)).toEqual({ outcome: 'serving' })
    expect(launches()).toEqual([])
    expect(acquireInstallLock).not.toHaveBeenCalled()
  })

  it('never starts a second process when the slot state is unprovable', async () => {
    host = stoppedHost()
    host.pidFiles.clear()

    expect(await wakeStoppedManagedOrcad(slot)).toEqual({ outcome: 'unverifiable' })
    expect(launches()).toEqual([])
  })

  it('defers to an update or recovery that holds the activation fence', async () => {
    host = stoppedHost()
    host.fence = true
    host.fenceFresh = true

    expect(await wakeStoppedManagedOrcad(slot)).toEqual({ outcome: 'fenced' })
    expect(launches()).toEqual([])
    expect(host.fence).toBe(true)
  })

  it('releases the fence its own wake left when the connection dropped, and starts the slot', async () => {
    host = stoppedHost()
    const lost = Object.assign(new Error('connection lost'), { sshChannelCloseConfirmed: false })
    vi.mocked(execCommand).mockImplementation(async (_conn, command) => {
      if (command.includes('nohup')) {
        throw lost
      }
      return host.exec(command)
    })
    await expect(wakeStoppedManagedOrcad(slot)).rejects.toBe(lost)
    expect(host.fence).toBe(true)

    vi.mocked(execCommand).mockImplementation(async (_conn, command) => host.exec(command))
    expect(await wakeStoppedManagedOrcad(slot)).toMatchObject({ outcome: 'started' })
    expect(launches()).toHaveLength(1)
    expect(host.fence).toBe(false)
  })

  it('releases its own fence on reconnect when the drop surfaced as a plain failure', async () => {
    host = stoppedHost()
    // A disconnect fails every later step, the fence release included, without the unconfirmed flag.
    const gone = new Error('Not connected')
    vi.mocked(execCommand).mockImplementation(async (_conn, command) => {
      if (command.includes('nohup') || command.includes('echo RELEASED')) {
        throw gone
      }
      return host.exec(command)
    })
    await expect(wakeStoppedManagedOrcad(slot)).rejects.toBe(gone)
    expect(host.fence).toBe(true)

    vi.mocked(execCommand).mockImplementation(async (_conn, command) => host.exec(command))
    expect(await wakeStoppedManagedOrcad(slot)).toMatchObject({ outcome: 'started' })
    expect(launches()).toHaveLength(1)
    expect(host.fence).toBe(false)
  })

  it('never claims a fence with no owner token, even while its own interrupted token is held', async () => {
    host = stoppedHost()
    const lost = Object.assign(new Error('connection lost'), { sshChannelCloseConfirmed: false })
    vi.mocked(execCommand).mockImplementation(async (_conn, command) => {
      if (command.includes('nohup')) {
        throw lost
      }
      return host.exec(command)
    })
    await expect(wakeStoppedManagedOrcad(slot)).rejects.toBe(lost)
    vi.mocked(execCommand).mockImplementation(async (_conn, command) => host.exec(command))
    // That fence was cleared unseen, and another desktop took a fresh one: no owner file yet.
    host.wakeOwner = null
    host.fenceFresh = true

    expect(await wakeStoppedManagedOrcad(slot)).toEqual({ outcome: 'fenced' })
    expect(host.fence).toBe(true)
    expect(launches()).toEqual([])
  })

  it('lets a wake on a dropped connection settle before a reconnected wake reads the fence', async () => {
    host = stoppedHost()
    const lost = Object.assign(new Error('connection lost'), { sshChannelCloseConfirmed: false })
    let drop: (() => void) | undefined
    vi.mocked(execCommand).mockImplementation(async (_conn, command) => {
      // Drops the first wake under its fence, after its owner token landed but before its launch.
      if (host.fence && host.wakeOwner && command.includes('orcad-active.json') && !drop) {
        await new Promise<void>((resolve) => (drop = resolve))
        throw lost
      }
      return host.exec(command)
    })
    const dropped = wakeStoppedManagedOrcad(slot)
    await vi.waitFor(() => expect(drop).toBeDefined())

    // The reconnected wake starts while the first is still holding the fence it just took.
    const reconnected = wakeStoppedManagedOrcad(slot)
    drop?.()
    await expect(dropped).rejects.toBe(lost)
    expect(await reconnected).toMatchObject({ outcome: 'started' })
    expect(launches()).toHaveLength(1)
    expect(host.fence).toBe(false)
  })

  it('proves a fence its own wake took even when the drop hid whether the lock was created', async () => {
    host = stoppedHost()
    const lost = Object.assign(new Error('connection lost'), { sshChannelCloseConfirmed: false })
    // The host created the lock (with its owner token), but the client never saw OK.
    vi.mocked(acquireInstallLock).mockImplementationOnce(async (_conn, _root, _host, options) => {
      host.acquireFence()
      host.wakeOwner = options?.owner?.token ?? null
      throw lost
    })
    await expect(wakeStoppedManagedOrcad(slot)).rejects.toBe(lost)
    expect(host.fence).toBe(true)

    expect(await wakeStoppedManagedOrcad(slot)).toMatchObject({ outcome: 'started' })
    expect(launches()).toHaveLength(1)
    expect(host.fence).toBe(false)
  })

  it('waits for a wake still before its fence instead of racing it to the lock', async () => {
    host = stoppedHost()
    const lost = Object.assign(new Error('connection lost'), { sshChannelCloseConfirmed: false })
    let drop: (() => void) | undefined
    vi.mocked(acquireInstallLock).mockImplementationOnce(async (_conn, _root, _host, options) => {
      host.acquireFence()
      host.wakeOwner = options?.owner?.token ?? null
      await new Promise<void>((resolve) => (drop = resolve))
      throw lost
    })
    const dropped = wakeStoppedManagedOrcad(slot)
    // The reconnected wake starts while the first is still taking the fence.
    const reconnected = wakeStoppedManagedOrcad(slot)
    await vi.waitFor(() => expect(drop).toBeDefined())
    drop?.()
    await expect(dropped).rejects.toBe(lost)
    expect(await reconnected).toMatchObject({ outcome: 'started' })
    expect(launches()).toHaveLength(1)
    expect(host.fence).toBe(false)
  })

  it('never releases a fence another run took after its own interrupted fence was cleared', async () => {
    host = stoppedHost()
    const lost = Object.assign(new Error('connection lost'), { sshChannelCloseConfirmed: false })
    vi.mocked(execCommand).mockImplementation(async (_conn, command) => {
      if (command.includes('nohup')) {
        throw lost
      }
      return host.exec(command)
    })
    await expect(wakeStoppedManagedOrcad(slot)).rejects.toBe(lost)
    vi.mocked(execCommand).mockImplementation(async (_conn, command) => host.exec(command))
    // A recovery cleared that fence, then another run took the host before journaling.
    host.wakeOwner = 'another-run'
    host.fenceFresh = true

    expect(await wakeStoppedManagedOrcad(slot)).toEqual({ outcome: 'fenced' })
    expect(host.fence).toBe(true)
    expect(launches()).toEqual([])
  })

  it('never releases a fence another client may hold, even after its own wake dropped', async () => {
    host = stoppedHost()
    host.fence = true
    host.fenceFresh = true
    expect(
      await wakeStoppedManagedOrcad({
        ...slot,
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: as above, a different target.
        conn: { getTarget: () => ({ id: 'ssh-2' }) } as unknown as OrcadHostTransport
      })
    ).toEqual({ outcome: 'fenced' })
    expect(host.fence).toBe(true)
  })

  it('drops an abandoned fence no journal backs, and starts the slot', async () => {
    host = stoppedHost()
    // A stale or exited-own fence: the recovery takeover may take it.
    host.fence = true
    host.wakeOwner = 'exited-run'

    expect(await wakeStoppedManagedOrcad(slot)).toMatchObject({ outcome: 'started' })
    expect(launches()).toHaveLength(1)
    expect(host.fence).toBe(false)
  })

  it('has nothing to start on a host with no activated server', async () => {
    host = new FakeOrcadHost()

    expect(await wakeStoppedManagedOrcad(slot)).toEqual({ outcome: 'not-activated' })
    expect(launches()).toEqual([])
  })
})

describe('startStoppedActiveOrcad', () => {
  it('answers the readiness of the slot it started', async () => {
    host = stoppedHost()

    const readiness = await startStoppedActiveOrcad(slot)

    expect(readiness).not.toBeNull()
    expect(launches()).toHaveLength(1)
  })

  it('answers nothing for a server that is already running', async () => {
    host = FakeOrcadHost.deployedOld()

    await expect(startStoppedActiveOrcad(slot)).resolves.toBeNull()
    expect(launches()).toEqual([])
  })

  it('answers nothing when the slot state cannot be proven', async () => {
    host = stoppedHost()
    host.pidFiles.clear()

    await expect(startStoppedActiveOrcad(slot)).resolves.toBeNull()
    expect(launches()).toEqual([])
  })
})

describe('probeOrWakeStoppedOrcadReadiness', () => {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: managedOrcadSlot reads only the connection, host, home and data dir.
  const context = {
    connection: slot.conn,
    host: slot.host,
    remoteHome: slot.remoteHome,
    userDataDir: slot.userDataDir
  } as unknown as OrcadRemoteContext
  const args = { context, localOrcadDir: '/local/orcad', fullVersion: OLD, port: slot.port }

  it('starts the deployed slot when its process is proven exited', async () => {
    host = stoppedHost()
    vi.mocked(probeManagedOrcadReadiness).mockRejectedValueOnce(
      new OrcadActiveReadinessError(
        'exited',
        'orcad is recorded active but its process has exited.'
      )
    )

    await expect(probeOrWakeStoppedOrcadReadiness(args)).resolves.toMatchObject({
      startedServer: true
    })
    expect(probeManagedOrcadReadiness).toHaveBeenCalledWith(context, '/local/orcad', OLD, undefined)
    expect(launches()).toHaveLength(1)
  })

  it('keeps a refusal that is not a proven exit, and starts nothing', async () => {
    host = stoppedHost()
    vi.mocked(probeManagedOrcadReadiness).mockRejectedValueOnce(
      new OrcadActiveReadinessError('unverifiable', 'orcad process state is unverifiable.')
    )

    await expect(probeOrWakeStoppedOrcadReadiness(args)).rejects.toBeInstanceOf(
      OrcadActiveReadinessError
    )
    expect(launches()).toEqual([])
  })

  it('answers a running server without starting anything', async () => {
    host = FakeOrcadHost.deployedOld()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the probe's answer is passed through untouched.
    const readiness = { boundEndpoint: 'ws://127.0.0.1:7777' } as ServeReadiness
    vi.mocked(probeManagedOrcadReadiness).mockResolvedValueOnce(readiness)

    await expect(probeOrWakeStoppedOrcadReadiness(args)).resolves.toEqual({
      readiness,
      startedServer: false
    })
    expect(launches()).toEqual([])
  })
})
