import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { lock } from 'proper-lockfile'

// A cold check takes minutes; an older reservation belongs to a killed check whose PID was reused.
const RESERVATION_MAX_AGE_MS = 30 * 60_000

// One ledger per user and host, not per worktree: every worktree's typecheck draws on the same RAM.
export function defaultAdmissionLedgerPath() {
  return join(tmpdir(), `orca-typecheck-admission-${process.getuid?.() ?? 'user'}.json`)
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

// Linux only: there the OOM killer ends processes once RAM runs out; macOS and Windows page out.
function readAvailableGib() {
  if (process.platform !== 'linux') {
    return Infinity
  }
  const match = /^MemAvailable:\s+(\d+) kB$/m.exec(readFileSync('/proc/meminfo', 'utf8'))
  return match ? Number(match[1]) / 1024 ** 2 : Infinity
}

function readReservations(ledgerPath) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(ledgerPath, 'utf8'))
  } catch {
    // Missing, or torn by a killed writer: admit as if idle rather than block every typecheck.
    return []
  }
  return Array.isArray(parsed)
    ? parsed.filter(
        (entry) =>
          typeof entry?.id === 'string' &&
          Number.isInteger(entry.pid) &&
          typeof entry.heapGib === 'number' &&
          typeof entry.reservedAt === 'number'
      )
    : []
}

async function updateLedger({ ledgerPath, acquireLock, isAlive }, update) {
  const release = await acquireLock(ledgerPath, {
    realpath: false,
    retries: { retries: 100, minTimeout: 20, maxTimeout: 250 }
  })
  try {
    // A killed typecheck never releases, so its reservation lasts only as long as its process.
    const live = readReservations(ledgerPath).filter(
      (entry) => Date.now() - entry.reservedAt < RESERVATION_MAX_AGE_MS && isAlive(entry.pid)
    )
    const { reservations, result } = update(live)
    writeFileSync(ledgerPath, JSON.stringify(reservations))
    return result
  } finally {
    await release()
  }
}

/**
 * Waits until the project's heap fits both the budget, alongside every typecheck already running
 * on this host from any worktree, and the memory still free; then reserves it. A project with no
 * other typecheck running is always admitted, so a full or small machine still makes progress.
 */
export async function acquireTypecheckAdmission({
  config,
  heapGib,
  budgetGib,
  ledgerPath = defaultAdmissionLedgerPath(),
  acquireLock = lock,
  isAlive = isProcessAlive,
  availableGib = readAvailableGib,
  pollMs = 2_000,
  log = console.error
}) {
  const ledger = { ledgerPath, acquireLock, isAlive }
  const reservation = { id: randomUUID(), pid: process.pid, config, heapGib }
  let announced = false
  for (;;) {
    const blocked = await updateLedger(ledger, (live) => {
      const claimed = live.reduce((sum, entry) => sum + entry.heapGib, 0)
      const free = availableGib()
      const fits = live.length === 0 || (claimed + heapGib <= budgetGib && free >= heapGib)
      return {
        reservations: fits ? [...live, { ...reservation, reservedAt: Date.now() }] : live,
        result: fits ? null : { claimed, free }
      }
    })
    if (blocked === null) {
      break
    }
    if (!announced) {
      const free = Number.isFinite(blocked.free) ? `, ${blocked.free.toFixed(1)} GiB free` : ''
      log(
        `Waiting to typecheck ${config} (${heapGib} GiB): other typechecks hold ${blocked.claimed} of ${budgetGib.toFixed(1)} GiB${free}`
      )
      announced = true
    }
    await sleep(pollMs)
  }
  return () =>
    updateLedger(ledger, (live) => ({
      reservations: live.filter((entry) => entry.id !== reservation.id),
      result: undefined
    }))
}
