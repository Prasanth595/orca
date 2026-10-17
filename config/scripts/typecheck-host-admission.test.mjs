import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { acquireTypecheckAdmission } from './typecheck-host-admission.mjs'

let directory
let ledgerPath

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'orca-typecheck-admission-test-'))
  ledgerPath = join(directory, 'ledger.json')
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

function reservations() {
  return JSON.parse(readFileSync(ledgerPath, 'utf8'))
}

function admit(project, options = {}) {
  return acquireTypecheckAdmission({
    budgetGib: 10,
    ledgerPath,
    availableGib: () => Infinity,
    pollMs: 5,
    log: () => {},
    ...project,
    ...options
  })
}

describe('typecheck host admission', () => {
  it('reserves the heap while the check runs and frees it on release', async () => {
    const release = await admit({ config: 'web', heapGib: 6 })
    expect(reservations()).toMatchObject([{ config: 'web', heapGib: 6, pid: process.pid }])
    await release()
    expect(reservations()).toEqual([])
  })

  it('admits checks together while they fit the budget', async () => {
    const web = await admit({ config: 'web', heapGib: 6 })
    const cli = await admit({ config: 'cli', heapGib: 2 })
    expect(reservations()).toHaveLength(2)
    await Promise.all([web(), cli()])
  })

  it('waits for a running check when both would exceed the budget', async () => {
    const node = await admit({ config: 'node', heapGib: 7 })
    let admitted = false
    const waiting = admit({ config: 'web', heapGib: 6 }).then((release) => {
      admitted = true
      return release
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(admitted).toBe(false)
    await node()
    const web = await waiting
    expect(reservations()).toMatchObject([{ config: 'web' }])
    await web()
  })

  it('waits for free memory even when the budget has room', async () => {
    const cli = await admit({ config: 'cli', heapGib: 2 })
    let freeGib = 3
    let admitted = false
    const waiting = admit({ config: 'web', heapGib: 6 }, { availableGib: () => freeGib }).then(
      (release) => {
        admitted = true
        return release
      }
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(admitted).toBe(false)
    freeGib = 8
    const web = await waiting
    await Promise.all([cli(), web()])
  })

  it('admits a check with nothing else running even when memory is short', async () => {
    const release = await admit({ config: 'web', heapGib: 6 }, { availableGib: () => 1 })
    expect(reservations()).toHaveLength(1)
    await release()
  })

  it('drops a reservation left behind by a killed typecheck', async () => {
    writeFileSync(
      ledgerPath,
      JSON.stringify([
        { id: 'killed', pid: 999_999, config: 'node', heapGib: 7, reservedAt: Date.now() }
      ])
    )
    const release = await admit(
      { config: 'web', heapGib: 6 },
      { isAlive: (pid) => pid === process.pid }
    )
    expect(reservations()).toMatchObject([{ config: 'web' }])
    await release()
  })

  it('expires a reservation whose PID was reused by an unrelated process', async () => {
    writeFileSync(
      ledgerPath,
      JSON.stringify([
        { id: 'reused', pid: process.pid, config: 'node', heapGib: 7, reservedAt: 0 }
      ])
    )
    const release = await admit({ config: 'web', heapGib: 6 })
    expect(reservations()).toMatchObject([{ config: 'web' }])
    await release()
  })

  it('runs a project larger than the whole budget when nothing else is running', async () => {
    const release = await admit({ config: 'node', heapGib: 7 }, { budgetGib: 4 })
    expect(reservations()).toHaveLength(1)
    await release()
  })

  it('treats a torn ledger as idle instead of blocking', async () => {
    writeFileSync(ledgerPath, '{"torn')
    const release = await admit({ config: 'web', heapGib: 6 })
    expect(reservations()).toHaveLength(1)
    await release()
  })
})
