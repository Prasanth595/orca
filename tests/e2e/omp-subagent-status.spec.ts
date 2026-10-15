import type { Page, TestInfo } from '@stablyai/playwright-test'
import type { AgentStatusEntry } from '../../src/shared/agent-status-types'
import { test, expect } from './helpers/orca-app'
import { readHookEndpoint } from './helpers/agent-hook-endpoint'
import type { NativeObservation, NativeRef } from './helpers/omp-native-observation'
import { startOmpStatusRuntime, type OmpStatusRuntime } from './helpers/omp-subagent-status-runtime'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  waitForActivePaneHookDescriptor,
  waitForActiveTerminalManager,
  type ActivePaneHookDescriptor
} from './helpers/terminal'
import { worktreeRow } from './worktree-row-locators'

// Real installed OMP task/wait/bash/registry/RPC; only model responses are local fixtures.
// ORCA_BACKGROUND_LAUNCH=1 ORCA_REAL_OMP_CLI_TEST=1 pnpm run test:e2e omp-subagent-status.spec.ts --workers=1
// Opt in to the same scenario at 8×6 with ORCA_OMP_SCALE=1, or 16×8 with ORCA_OMP_SCALE_STRESS=1.
// Optional ORCA_OMP_PROOF_BINARY=/absolute/path/to/omp; artifacts remain under test-results/.
const CHILD_NAMES = [
  'IndexAudit',
  'ArtifactCheck',
  'QuietWorker',
  'DocScan',
  'BuildCheck',
  'EdgeAudit',
  'OwnerCheck',
  'RootFence'
]
const QUIET_MS = 10_500 // Two real five-second authoritative refresh periods, without fake clocks.
const STABLE_FIELDS = [
  'state',
  'prompt',
  'toolName',
  'toolInput',
  'lastAssistantMessage',
  'stateStartedAt',
  'turnStartedAt',
  'stateHistory',
  'providerSession',
  'subagents'
] as const
declare global {
  var __ompIsolationCheck: (() => string | undefined) | undefined
}

test.skip(process.env.ORCA_REAL_OMP_CLI_TEST !== '1', 'Opt-in installed OMP native scenario')
test.use({ minimumSeededWorktreeCount: 1 })
test.beforeAll(() => {
  if (process.env.ORCA_BACKGROUND_LAUNCH !== '1' || process.env.ORCA_E2E_FORCE_HEADFUL === '1') {
    throw new Error('Native OMP E2E requires ORCA_BACKGROUND_LAUNCH=1 and the hidden renderer')
  }
})

type Root = ActivePaneHookDescriptor & {
  runtime: OmpStatusRuntime
  native: NativeObservation
  label: string
  remaining: string[]
  asyncName: string
}

function nativeRoot(runtime: OmpStatusRuntime): NativeObservation {
  const root = runtime
    .observations()
    .findLast((row) => row.kind === 'context' && row.agentKind === 'main')
  if (!root?.sessionId || !root.ownerMatches) {
    throw new Error(`No exact native root-manager ownership: ${runtime.directory}`)
  }
  return root
}

function nativeChildren(root: Root): NativeRef[] {
  const snapshot = root.runtime
    .observations()
    .findLast((row) => row.kind === 'registry' && row.sessionId === root.native.sessionId)
  return (snapshot?.refs ?? []).filter(
    (ref) =>
      ref.kind === 'sub' &&
      ref.parentId === root.native.id &&
      ((ref.status === 'running' && ref.isStreaming === true) || ref.pendingAsync === true)
  )
}

type PaneStatus = AgentStatusEntry & {
  subagents: NonNullable<AgentStatusEntry['subagents']>
}

function readStatuses(page: Page, roots: Root[]): Promise<Record<string, PaneStatus | null>> {
  return page.evaluate(
    (keys) => {
      const state = window.__store!.getState()
      return Object.fromEntries(
        keys.map((key) => {
          const row = state.agentStatusByPaneKey[key]
          return [key, row ? { ...row, subagents: row.subagents ?? [] } : null]
        })
      )
    },
    roots.map((root) => root.paneKey)
  )
}

function expectStable(actual: PaneStatus | null | undefined, before: PaneStatus) {
  expect(STABLE_FIELDS.map((field) => actual?.[field])).toEqual(
    STABLE_FIELDS.map((field) => before[field])
  )
}

async function expectRosters(page: Page, roots: Root[]) {
  let statuses: Record<string, PaneStatus | null> = {}
  await expect(async () => {
    statuses = await readStatuses(page, roots)
    for (const root of roots) {
      const row = statuses[root.paneKey]
      const refs = nativeChildren(root)
      expect(row).toMatchObject({
        state: 'working',
        prompt: root.label,
        toolName: 'wait',
        providerSession: { id: root.native.sessionId, transcriptPath: root.native.sessionFile }
      })
      expect(refs).toHaveLength(root.remaining.length)
      expect(root.remaining.every((name) => refs.some((ref) => ref.id.includes(name)))).toBe(true)
      expect(row!.subagents.map((child) => child.id).sort()).toEqual(
        refs.map((ref) => ref.id).sort()
      )
      expect(new Set(refs.map((ref) => ref.sessionId)).size).toBe(refs.length)
      expect(refs.every((ref) => ref.sessionId && ref.sessionId !== root.native.sessionId)).toBe(
        true
      )
      for (const child of row!.subagents) {
        expect(child).toMatchObject({
          state: 'working',
          startedAt: refs.find((ref) => ref.id === child.id)?.createdAt
        })
      }
      const paused = refs.find((ref) => ref.id.includes(root.asyncName))
      expect(paused).toMatchObject({
        status: 'idle',
        isStreaming: false,
        pendingAsync: true,
        terminalAt: expect.any(Number)
      })
      const facts = root.runtime.observations().filter((entry) => entry.at >= root.native.at)
      const contexts = facts.filter(
        (entry) => entry.kind === 'context' && entry.agentKind === 'sub'
      )
      expect(
        refs.every((ref) =>
          contexts.some(
            (context) =>
              context.ownerMatches && context.id === ref.id && context.sessionId === ref.sessionId
          )
        )
      ).toBe(true)
      expect(facts).toContainEqual(
        expect.objectContaining({
          kind: 'extension',
          sessionId: paused!.sessionId,
          name: 'agent_end',
          willContinue: true
        })
      )
      expect(facts).toContainEqual(
        expect.objectContaining({
          kind: 'extension',
          sessionId: paused!.sessionId,
          toolName: 'bash',
          asyncJobId: expect.anything(),
          asyncState: 'running'
        })
      )
      expect(facts.filter((entry) => entry.kind === 'network-blocked')).toEqual([])
      expect(
        facts
          .filter((entry) => entry.kind === 'hook')
          .every(
            (entry) =>
              entry.accepted &&
              entry.sessionId === root.native.sessionId &&
              (!entry.sessionFile || entry.sessionFile === root.native.sessionFile)
          )
      ).toBe(true)
    }
  }).toPass({ timeout: 90_000 })
  return statuses
}

async function expectUnprompted(page: Page, roots: Root[]) {
  await page.waitForTimeout(6_500)
  const statuses = await readStatuses(page, roots)
  for (const root of roots) {
    const row = statuses[root.paneKey]
    expect(row?.state).not.toBe('working')
    expect(row?.subagents ?? []).toEqual([])
    if (!row || row.providerSession?.id === root.native.sessionId) {
      expect(row?.turnStartedAt).toBeUndefined()
    }
    const facts = root.runtime.observations().filter((entry) => entry.at >= root.native.at)
    expect(facts.filter((entry) => entry.kind === 'model-request')).toEqual([])
    expect(facts.filter((entry) => entry.kind === 'hook' && entry.rootState === 'working')).toEqual(
      []
    )
  }
}

async function finishRoots(page: Page, roots: Root[], names: string[]) {
  const finishing = roots.map((root) => ({ root, refs: nativeChildren(root) }))
  await Promise.all(
    roots.map(async (root) => {
      await root.runtime.release('root-finish')
      await Promise.all(names.map((name) => root.runtime.release(name)))
    })
  )
  await expect
    .poll(
      async () => {
        const statuses = await readStatuses(page, roots)
        return finishing.every(({ root, refs }) => {
          const facts = root.runtime.observations().filter((row) => row.at >= root.native.at)
          return (
            statuses[root.paneKey]?.state === 'done' &&
            statuses[root.paneKey]?.subagents.length === 0 &&
            nativeChildren(root).length === 0 &&
            refs.every((ref) =>
              facts.some(
                (row) => row.kind === 'lifecycle' && row.id === ref.id && row.status === 'completed'
              )
            ) &&
            facts.some(
              (row) => row.kind === 'async-model-resumed' && row.name === root.asyncName
            ) &&
            facts.some(
              (row) =>
                row.kind === 'hook' &&
                row.accepted &&
                row.sessionId === root.native.sessionId &&
                row.hookEvent === 'agent_end' &&
                row.subagentIds?.length === 0
            )
          )
        })
      },
      { timeout: 30_000 }
    )
    .toBe(true)
}

async function captureCompact(page: Page, worktreeId: string, info: TestInfo, name: string) {
  // Crop out account/host/project details; never show or focus a BrowserWindow.
  const file = info.outputPath(`${name}.png`)
  await worktreeRow(page, worktreeId)
    .locator('[data-compact-agent-list]')
    .screenshot({ path: file, animations: 'disabled' })
  await info.attach(name, { path: file, contentType: 'image/png' })
}

async function expectCompact(page: Page, roots: Root[], info: TestInfo) {
  const root = roots[0]!
  const surface = worktreeRow(page, root.worktreeId).locator('[data-compact-agent-list]')
  const summary = surface.locator('button.compact-agent-summary-button')
  await expect(summary).toBeVisible()
  await expect(summary).toHaveAttribute('aria-expanded', 'false')
  await captureCompact(page, root.worktreeId, info, 'native-compact-collapsed')
  await summary.click()
  await expect(summary).toHaveAttribute('aria-expanded', 'true')
  const rootRow = surface.locator('.agent-disclosure-row').filter({
    has: page.locator('span[title]').filter({ hasText: root.label })
  })
  await expect(rootRow).toBeVisible()
  const disclosure = rootRow.locator('[data-agent-child-disclosure-button]')
  const expansion = rootRow.locator('xpath=following-sibling::*[1]')
  const childRows = expansion.locator('.agent-disclosure-row')
  await expect(childRows).toHaveCount(root.remaining.length)
  await disclosure.click()
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false')
  await expect(expansion).toHaveAttribute('aria-hidden', 'true')
  await expect(expansion).toHaveJSProperty('inert', true)
  // CompactAgentExpansion intentionally retains its descendants while collapsed.
  await expect(childRows).toHaveCount(root.remaining.length)
  await disclosure.click()
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true')
  await expect(expansion).toHaveAttribute('aria-hidden', 'false')
  await expect(expansion).toHaveJSProperty('inert', false)
  for (const ref of nativeChildren(root)) {
    await expect(expansion.getByTitle(`${ref.id} - status-smoke`, { exact: true })).toBeVisible()
  }
  await captureCompact(page, root.worktreeId, info, 'native-compact-expanded')
  await summary.click()
  await expect(summary).toHaveAttribute('aria-expanded', 'false')
}

for (const workload of [
  { roots: 2, children: 3, enabled: true },
  { roots: 8, children: 6, enabled: process.env.ORCA_OMP_SCALE === '1' },
  { roots: 16, children: 8, enabled: process.env.ORCA_OMP_SCALE_STRESS === '1' }
]) {
  test(`${workload.roots} roots × ${workload.children} native children keep compact status through quiet refresh and session replacement`, async ({
    orcaPage,
    electronApp
  }, testInfo) => {
    test.skip(!workload.enabled, 'Opt-in larger native workload')
    test.setTimeout(600_000)
    const owned: OmpStatusRuntime[] = []
    try {
      await waitForSessionReady(orcaPage)
      const worktreeId = await waitForActiveWorktree(orcaPage)
      await ensureTerminalVisible(orcaPage)
      await orcaPage.evaluate(() => {
        const state = window.__store!.getState()
        if (!state.worktreeCardProperties.includes('inline-agents')) {
          state.setWorktreeCardProperties([...state.worktreeCardProperties, 'inline-agents'])
        }
      })
      const panes: ActivePaneHookDescriptor[] = []
      for (let index = 0; index < workload.roots; index++) {
        if (index > 0) {
          await orcaPage.evaluate((id) => {
            const state = window.__store!.getState()
            const tab = state.createTab(id)
            state.setActiveTab(tab.id)
            state.setActiveTabType('terminal', id)
          }, worktreeId)
        }
        await waitForActiveTerminalManager(orcaPage, 30_000)
        panes.push(await waitForActivePaneHookDescriptor(orcaPage))
      }
      expect(new Set(panes.map((pane) => pane.paneKey)).size).toBe(workload.roots)
      expect(
        await electronApp.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().every((window) => !window.isVisible())
        )
      ).toBe(true)
      const endpoint = await readHookEndpoint(electronApp)
      const names = CHILD_NAMES.slice(0, workload.children) // Reuse every name in every root.
      const starts = await Promise.allSettled(
        panes.map(async (pane, index): Promise<Root> => {
          const label = `Native OMP root ${String(index + 1).padStart(2, '0')}`
          const runtime = await startOmpStatusRuntime({
            ...pane,
            directory: testInfo.outputPath(`native-root-${index + 1}`),
            rootLabel: label,
            names,
            endpoint,
            asyncChildNames: [names[2]!]
          })
          owned.push(runtime)
          return {
            ...pane,
            runtime,
            native: nativeRoot(runtime),
            label,
            remaining: names,
            asyncName: names[2]!
          }
        })
      )
      const failure = starts.find((result) => result.status === 'rejected')
      if (failure?.status === 'rejected') {
        throw failure.reason
      }
      const roots = starts.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : []
      )
      await testInfo.attach('installed-omp-version', {
        body: roots[0]!.runtime.version,
        contentType: 'text/plain'
      })
      await expectUnprompted(orcaPage, roots)
      await Promise.all(
        roots.map(async (root) => {
          await root.runtime.command('prompt', { message: root.label })
          const state = (await root.runtime.command('get_state')).data
          expect(state?.sessionId).toBe(root.native.sessionId)
          expect(state?.sessionFile).toBeTruthy()
          root.native.sessionFile = state?.sessionFile
        })
      )
      expect(new Set(roots.map((root) => root.native.sessionId)).size).toBe(roots.length)
      expect(new Set(roots.map((root) => root.native.sessionFile)).size).toBe(roots.length)
      const initial = await expectRosters(orcaPage, roots)
      await expectCompact(orcaPage, roots, testInfo)
      const beforeQuiet = await readStatuses(orcaPage, roots)
      const quietSince = Date.now()
      await orcaPage.waitForTimeout(QUIET_MS)
      const afterQuiet = await expectRosters(orcaPage, roots)
      for (const root of roots) {
        expectStable(afterQuiet[root.paneKey], beforeQuiet[root.paneKey]!)
        expect(afterQuiet[root.paneKey]!.updatedAt).toBeGreaterThan(
          beforeQuiet[root.paneKey]!.updatedAt
        )
        const facts = root.runtime.observations().filter((row) => row.at >= quietSince)
        expect(
          facts.filter((row) => row.kind === 'model-request' || row.kind === 'extension')
        ).toEqual([])
        const refreshes = facts.filter(
          (row) => row.kind === 'hook' && row.accepted && row.hookEvent === 'subagents_update'
        )
        expect(refreshes.length).toBeGreaterThanOrEqual(2)
        for (const refresh of refreshes) {
          expect(refresh.subagentIds?.sort()).toEqual(
            nativeChildren(root)
              .map((ref) => ref.id)
              .sort()
          )
        }
      }
      const changed = roots.filter((_, index) => index % 2 === 0)
      const unchanged = roots.filter((_, index) => index % 2 === 1)
      await Promise.all(
        changed.map(async (root) => {
          const refs = nativeChildren(root)
          const cancel = refs.find((ref) => ref.id.includes(names[1]!))!
          const complete = refs.find((ref) => ref.id.includes(names[0]!))!
          expect(
            (await root.runtime.command('cancel_subagent', { subagentId: cancel.id })).data
              ?.cancelled
          ).toBe(true)
          await root.runtime.release(names[0]!)
          root.remaining = names.slice(2)
          await expect
            .poll(() =>
              [cancel, complete].every((ref, index) =>
                root.runtime
                  .observations()
                  .some(
                    (row) =>
                      row.kind === 'lifecycle' &&
                      row.id === ref.id &&
                      row.status === (index === 0 ? 'aborted' : 'completed')
                  )
              )
            )
            .toBe(true)
        })
      )
      const afterBurst = await expectRosters(orcaPage, roots)
      for (const root of unchanged) {
        expectStable(afterBurst[root.paneKey], beforeQuiet[root.paneKey]!)
      }
      const rebound = changed.filter((_, index) => index % 2 === 0)
      const live = roots.filter((root) => !rebound.includes(root))
      // Remember only a violation, not a stream of successful status samples.
      await orcaPage.evaluate(
        ({ keys, baseline, fields }) => {
          let fault: string | undefined
          const unsubscribe = window.__store!.subscribe((state) => {
            for (const key of keys) {
              const row = state.agentStatusByPaneKey[key]
              if (
                !row ||
                JSON.stringify(fields.map((field) => row[field])) !==
                  JSON.stringify(fields.map((field) => baseline[key]![field]))
              ) {
                fault ??= key
              }
            }
          })
          globalThis.__ompIsolationCheck = () => {
            unsubscribe()
            return fault
          }
        },
        { keys: live.map((root) => root.paneKey), baseline: afterBurst, fields: STABLE_FIELDS }
      )
      await finishRoots(orcaPage, rebound, names)
      await Promise.all(
        rebound.map(async (root) => {
          await expect
            .poll(async () => (await root.runtime.command('get_state')).data?.isSettled)
            .toBe(true)
          const old = root.native
          await root.runtime.resetGates()
          expect((await root.runtime.command('new_session')).data?.cancelled).toBe(false)
          root.native = nativeRoot(root.runtime)
          expect(root.native).toMatchObject({ name: 'session_switch', managerId: old.managerId })
          expect(root.native.sessionId).not.toBe(old.sessionId)
          root.label = root.label.replace('root', 'rebound root')
          root.remaining = names
        })
      )
      await expectUnprompted(orcaPage, rebound)
      await Promise.all(
        rebound.map(async (root) => {
          await root.runtime.command('prompt', { message: root.label })
          await expect
            .poll(() =>
              root.runtime
                .observations()
                .some((row) => row.kind === 'root-model-held' && row.at >= root.native.at)
            )
            .toBe(true)
          const state = (await root.runtime.command('get_state')).data
          expect(state?.sessionFile).toBeTruthy()
          expect(state?.sessionFile).not.toBe(
            initial[root.paneKey]!.providerSession?.transcriptPath
          )
          root.native.sessionFile = state?.sessionFile
        })
      )
      await expect
        .poll(
          async () => {
            const statuses = await readStatuses(orcaPage, rebound)
            return rebound.every((root) => {
              const row = statuses[root.paneKey]
              return (
                row?.state === 'working' &&
                row.prompt === root.label &&
                !row.toolName &&
                !row.lastAssistantMessage &&
                row.subagents.length === 0 &&
                row.providerSession?.id === root.native.sessionId
              )
            })
          },
          { timeout: 15_000 }
        )
        .toBe(true)
      const preflight = await readStatuses(orcaPage, rebound)
      for (const root of rebound) {
        const row = preflight[root.paneKey]!
        expect(row.stateStartedAt).toBeGreaterThanOrEqual(root.native.at)
        expect(row.stateStartedAt).toBeGreaterThan(initial[root.paneKey]!.stateStartedAt)
        if (row.turnStartedAt !== undefined) {
          expect(row.turnStartedAt).toBeGreaterThanOrEqual(root.native.at)
          expect(row.turnStartedAt).toBeGreaterThan(initial[root.paneKey]!.turnStartedAt ?? 0)
        }
      }
      await Promise.all(rebound.map((root) => root.runtime.release('root-start')))
      const afterRebind = await expectRosters(orcaPage, roots)
      expect(new Set(roots.map((root) => root.native.sessionFile)).size).toBe(roots.length)
      for (const root of rebound) {
        expect(
          afterRebind[root.paneKey]!.subagents.every(
            (child) =>
              child.startedAt >
              Math.max(...initial[root.paneKey]!.subagents.map((previous) => previous.startedAt))
          )
        ).toBe(true)
      }
      for (const root of live) {
        expectStable(afterRebind[root.paneKey], afterBurst[root.paneKey]!)
      }
      expect(await orcaPage.evaluate(() => globalThis.__ompIsolationCheck?.())).toBeUndefined()
      await finishRoots(orcaPage, roots, names)
      const compact = worktreeRow(orcaPage, worktreeId).locator('[data-compact-agent-list]')
      await expect(compact.locator('[data-agent-child-disclosure-button]')).toHaveCount(0)
      await expect(compact.locator('[aria-label="Working"]')).toHaveCount(0)
      expect(
        await electronApp.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().every((window) => !window.isVisible())
        )
      ).toBe(true)
    } finally {
      await orcaPage.evaluate(() => globalThis.__ompIsolationCheck?.()).catch(() => {})
      // Wait for every start above, and release native bash children even after failed assertions.
      await Promise.allSettled(owned.map((runtime) => runtime.stop()))
    }
  })
}
