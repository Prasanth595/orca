import { writeFile } from 'node:fs/promises'
import type { Page } from '@stablyai/playwright-test'
import { DEFAULT_AGENT_ACTIVITY_DISPLAY_MODE } from '../../src/shared/constants'
import { test, expect } from './helpers/orca-app'
import { readHookEndpoint } from './helpers/agent-hook-endpoint'
import type { OmpStatusRuntime } from './helpers/omp-subagent-status-runtime'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  waitForActivePaneHookDescriptor,
  waitForActiveTerminalManager,
  type ActivePaneHookDescriptor
} from './helpers/terminal'
import {
  nativeRoot,
  nativeChildren,
  waitNativeChildren,
  startRoots,
  type ScaleRoot,
  type NativeAction
} from './omp-subagent-scale-roots'
import {
  expectUnpromptedRoots,
  expectRootRosters,
  expectStableRoot,
  expectQuietNative
} from './omp-subagent-scale-roster-assertions'
import { captureCompact, proveCompact } from './omp-subagent-scale-compact-sidebar'
import {
  electronScaleSnapshot,
  latencyDistribution,
  nativeScaleWindow,
  quietRefreshEvidence,
  readScalePaneStatuses,
  readScaleRendererProbe,
  startScaleRendererProbe,
  type ScaleRendererEvidence
} from './omp-subagent-scale-metrics'

// Installed OMP 18.10.3+, native task/wait/bash/registry/RPC, real hook server and hidden renderer.
// Loaded: ORCA_BACKGROUND_LAUNCH=1 ORCA_REAL_OMP_CLI_TEST=1 pnpm run test:e2e omp-subagent-scale.spec.ts --workers=1 --grep '8 roots'
// Stress: ORCA_BACKGROUND_LAUNCH=1 ORCA_REAL_OMP_CLI_TEST=1 ORCA_OMP_SCALE_STRESS=1 pnpm run test:e2e omp-subagent-scale.spec.ts --workers=1 --grep '16 roots'
// Optional ORCA_OMP_PROOF_BINARY=/absolute/path/to/omp and SKIP_BUILD=1 after an e2e build.
// Observer-disabled controls match the steady native workload; startup and churn are reported separately.
const QUIET_MS = 16_500 // At least three actual 5s authoritative refresh periods per root.
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

test.skip(
  process.env.ORCA_REAL_OMP_CLI_TEST !== '1',
  'Opt-in installed OMP multi-root scale workload'
)
test.use({
  minimumSeededWorktreeCount: 1,
  // A hidden Chromium timer must measure execution lag, not intentional background timer clamping.
  orcaAppExtraArgs: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding']
})
test.beforeAll(() => {
  if (process.env.ORCA_BACKGROUND_LAUNCH !== '1' || process.env.ORCA_E2E_FORCE_HEADFUL === '1') {
    throw new Error('Native OMP scale requires ORCA_BACKGROUND_LAUNCH=1 and a hidden renderer')
  }
})

function nativeTerminalConvergence(
  roots: ScaleRoot[],
  actions: NativeAction[],
  renderer: ScaleRendererEvidence
) {
  const convergence = actions.map((action) => {
    const root = roots.find((candidate) => candidate.paneKey === action.paneKey)!
    const observations = root.runtime.observations()
    const terminal = observations.find(
      (row) =>
        row.kind === 'native-terminal' &&
        row.id === action.id &&
        row.sessionId === action.sessionId &&
        row.createdAt === action.createdAt &&
        row.at >= action.requestedAt &&
        row.status === (action.status === 'aborted' ? 'aborted' : 'idle')
    )
    const lifecycle = observations.find(
      (row) =>
        row.kind === 'lifecycle' &&
        row.id === action.id &&
        row.sessionId === action.sessionId &&
        row.status === action.status &&
        row.at >= action.requestedAt
    )
    const publication = renderer.snapshots.find(
      (row) =>
        row.paneKey === action.paneKey &&
        row.at >= action.requestedAt &&
        row.status !== null &&
        row.status.providerSession?.id === action.sessionId &&
        !row.status.subagents.some((child) => child.id === action.id)
    )
    if (!terminal || !lifecycle || !publication) {
      throw new Error(
        `Missing native transition, outcome confirmation or RootStore publication for ${action.id}`
      )
    }
    // Lifecycle emission follows native acceptance/artifact cleanup; it confirms outcome, not timing origin.
    expect(
      publication.at,
      'UI membership must not disappear before qualifying native terminal evidence'
    ).toBeGreaterThanOrEqual(terminal.at)
    return {
      ...action,
      nativeTransitionAt: terminal.at,
      nativeTransition: terminal,
      lifecycleAt: lifecycle.at,
      rendererAt: publication.at,
      convergenceMs: publication.at - terminal.at,
      requestToTerminalMs: terminal.at - action.requestedAt
    }
  })
  for (const root of roots) {
    const scoped = convergence.filter((row) => row.paneKey === root.paneKey)
    if (!scoped.length) {
      continue
    }
    const done = renderer.snapshots.find(
      (row) =>
        row.paneKey === root.paneKey &&
        row.at >= Math.min(...scoped.map((action) => action.requestedAt)) &&
        row.status?.state === 'done'
    )
    if (done) {
      expect(done.at).toBeGreaterThanOrEqual(
        Math.max(...scoped.map((action) => action.nativeTransitionAt))
      )
    }
  }
  return convergence
}

async function finishRoots(page: Page, roots: ScaleRoot[]) {
  const actions: NativeAction[] = roots.flatMap((root) =>
    nativeChildren(root).map((ref) => ({
      paneKey: root.paneKey,
      sessionId: root.native.sessionId!,
      id: ref.id,
      createdAt: ref.createdAt,
      requestedAt: Date.now(),
      status: 'completed' as const
    }))
  )
  await Promise.all(
    roots.map(async (root) => {
      await root.runtime.release('root-finish')
      await Promise.all(root.names.map((name) => root.runtime.release(name)))
    })
  )
  await expect
    .poll(
      async () => {
        const statuses = await readScalePaneStatuses(
          page,
          roots.map((root) => root.paneKey)
        )
        return roots.every(
          (root) =>
            statuses[root.paneKey]?.state === 'done' &&
            statuses[root.paneKey]?.subagents.length === 0
        )
      },
      { timeout: 15_000, intervals: [50, 100, 200] }
    )
    .toBe(true)
  await expect
    .poll(
      () =>
        roots.every((root) =>
          root.runtime
            .observations()
            .some(
              (row) =>
                row.kind === 'hook' &&
                row.accepted &&
                row.sessionId === root.native.sessionId &&
                row.hookEvent === 'agent_end' &&
                row.subagentCount === 0
            )
        ),
      { timeout: 10_000 }
    )
    .toBe(true)
  await expect
    .poll(
      () =>
        actions.every((action) =>
          roots
            .find((root) => root.paneKey === action.paneKey)!
            .runtime.observations()
            .some(
              (row) =>
                row.kind === 'lifecycle' &&
                row.id === action.id &&
                row.status === action.status &&
                row.at >= action.requestedAt
            )
        ),
      { timeout: 10_000 }
    )
    .toBe(true)
  for (const root of roots) {
    for (const name of root.asyncNames) {
      expect(
        root.runtime
          .observations()
          .some(
            (row) =>
              row.kind === 'async-model-resumed' && row.name === name && row.at >= root.native.at
          )
      ).toBe(true)
    }
  }
  return actions
}

async function rebindRoots(page: Page, roots: ScaleRoot[]) {
  const previous = await readScalePaneStatuses(
    page,
    roots.map((root) => root.paneKey)
  )
  const switches = await Promise.all(
    roots.map(async (root) => {
      await expect
        .poll(async () => (await root.runtime.command('get_state')).data?.isSettled)
        .toBe(true)
      const old = root.native
      await root.runtime.resetGates()
      expect((await root.runtime.command('new_session')).data?.cancelled).toBe(false)
      root.native = nativeRoot(root.runtime)
      expect(root.native.sessionId).not.toBe(old.sessionId)
      expect(root.native.managerId).toBe(old.managerId)
      expect(root.native.name).toBe('session_switch')
      return { paneKey: root.paneKey, old, next: root.native }
    })
  )
  const idle = await expectUnpromptedRoots(page, roots)
  const evidence = await Promise.all(
    roots.map(async (root, index) => {
      const old = switches[index]!.old
      root.label = root.label.replace('scale root', 'scale rebound root')
      const requestedAt = Date.now()
      await root.runtime.command('prompt', { message: root.label })
      await expect
        .poll(() =>
          root.runtime
            .observations()
            .some((row) => row.kind === 'root-model-held' && row.at >= requestedAt)
        )
        .toBe(true)
      const state = (await root.runtime.command('get_state')).data
      expect(state?.sessionFile).toBeTruthy()
      expect(state?.sessionFile).not.toBe(old.sessionFile)
      root.native.sessionFile = state?.sessionFile
      return { paneKey: root.paneKey, old, next: root.native, requestedAt }
    })
  )
  await expect
    .poll(
      async () => {
        const statuses = await readScalePaneStatuses(
          page,
          roots.map((root) => root.paneKey)
        )
        return roots.every((root) => {
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
      { timeout: 10_000 }
    )
    .toBe(true)
  const preflight = await readScalePaneStatuses(
    page,
    roots.map((root) => root.paneKey)
  )
  for (const root of roots) {
    const row = preflight[root.paneKey]!
    const opening = root.runtime
      .observations()
      .findLast(
        (hook) =>
          hook.kind === 'hook' &&
          hook.accepted &&
          hook.sessionId === root.native.sessionId &&
          hook.hookEvent === 'before_agent_start'
      )
    expect(row.stateStartedAt).toBeGreaterThanOrEqual(root.native.at)
    expect(row.stateStartedAt).toBeGreaterThan(previous[root.paneKey]!.stateStartedAt)
    // before_agent_start can be coalesced away; authoritative snapshots must not invent a turn clock.
    if (opening) {
      expect(row.turnStartedAt).toBeGreaterThanOrEqual(root.native.at)
      expect(row.turnStartedAt).toBeLessThanOrEqual(row.updatedAt)
    } else {
      expect(row.turnStartedAt).toBeUndefined()
    }
  }
  await Promise.all(roots.map((root) => root.runtime.release('root-start')))
  await waitNativeChildren(roots)
  await expectRootRosters(page, roots)
  return { identities: evidence, idle, preflight }
}

for (const workload of [
  { roots: 8, children: 6 },
  { roots: 16, children: 8 }
]) {
  test(`${workload.roots} roots × ${workload.children} native children preserve compact status under silence and churn`, async ({
    orcaPage,
    electronApp
  }, testInfo) => {
    test.skip(
      workload.roots === 16 && process.env.ORCA_OMP_SCALE_STRESS !== '1',
      'Opt-in 128-worker native stress workload'
    )
    test.setTimeout(600_000)
    const owned = new Set<OmpStatusRuntime>()
    const report: Record<string, unknown> = {
      workload,
      quietMs: QUIET_MS,
      observerControlScope: 'matched steady task/wait; startup excluded'
    }
    let probeInstalled = false
    try {
      await waitForSessionReady(orcaPage)
      const worktreeId = await waitForActiveWorktree(orcaPage)
      await ensureTerminalVisible(orcaPage)
      expect(
        await orcaPage.evaluate(
          (fallback) => window.__store!.getState().agentActivityDisplayMode ?? fallback,
          DEFAULT_AGENT_ACTIVITY_DISPLAY_MODE
        )
      ).toBe('compact')
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
      const endpoint = await readHookEndpoint(electronApp)
      const names = CHILD_NAMES.slice(0, workload.children) // All roots intentionally reuse every child name.
      await startScaleRendererProbe(
        orcaPage,
        panes.map((pane) => pane.paneKey)
      )
      probeInstalled = true
      const baseline = await electronScaleSnapshot(electronApp)
      expect(baseline.hidden).toBe(true)
      const control = await startRoots({
        panes,
        names,
        endpoint,
        observerEnabled: false,
        testInfo,
        owned
      })
      await orcaPage.waitForTimeout(750)
      const controlBefore = await electronScaleSnapshot(electronApp)
      const controlSince = Date.now()
      await orcaPage.waitForTimeout(QUIET_MS)
      const controlUntil = Date.now()
      const controlAfter = await electronScaleSnapshot(electronApp)
      for (const root of control) {
        expectQuietNative(root, controlSince, controlUntil)
        expect(nativeChildren(root)).toHaveLength(workload.children)
        expect(root.runtime.observations().filter((row) => row.kind === 'hook')).toEqual([])
      }
      const controlAsyncPause = control
        .filter((root) => root.asyncNames.length)
        .map((root) => {
          const refs = nativeChildren(root).filter((ref) =>
            root.asyncNames.some((name) => ref.id.includes(name))
          )
          expect(refs).toHaveLength(root.asyncNames.length)
          for (const ref of refs) {
            expect(ref).toMatchObject({ status: 'idle', isStreaming: false, pendingAsync: true })
          }
          const jobs = root.runtime
            .observations()
            .filter(
              (event) =>
                event.kind === 'extension' &&
                event.toolName === 'bash' &&
                event.asyncJobId &&
                event.asyncState === 'running' &&
                refs.some((ref) => ref.sessionId === event.sessionId)
            )
          expect(jobs).toHaveLength(root.asyncNames.length)
          expect(
            root.runtime
              .observations()
              .filter(
                (event) =>
                  event.kind === 'native-terminal' &&
                  refs.some((ref) => ref.id === event.id && ref.createdAt === event.createdAt)
              )
          ).toEqual([])
          return { paneKey: root.paneKey, asyncNames: root.asyncNames, refs, jobs }
        })
      const controlMetrics = control.map((root) =>
        nativeScaleWindow(root.runtime, controlSince, controlUntil)
      )
      report.control = {
        since: controlSince,
        until: controlUntil,
        before: controlBefore,
        after: controlAfter,
        roots: controlMetrics,
        nativeAsyncPause: controlAsyncPause
      }
      await Promise.all(
        control.map(async (root) => {
          await root.runtime.stop()
          owned.delete(root.runtime)
        })
      )
      const roots = await startRoots({
        panes,
        names,
        endpoint,
        observerEnabled: true,
        testInfo,
        owned,
        beforePrompt: async (unprompted) => {
          report.idleStartup = await expectUnpromptedRoots(orcaPage, unprompted, true)
        }
      })
      expect(roots.map((root) => root.asyncNames)).toEqual(control.map((root) => root.asyncNames))
      const initial = await expectRootRosters(orcaPage, roots)
      const initialRenderer = await readScaleRendererProbe(orcaPage)
      const startup = roots.map((root) => {
        const visible = initialRenderer.snapshots.find(
          (row) =>
            row.paneKey === root.paneKey &&
            row.status !== null &&
            row.status.providerSession?.id === root.native.sessionId &&
            row.status.subagents.length === workload.children
        )
        if (!visible) {
          throw new Error('No initial RootStore native roster receipt')
        }
        return {
          paneKey: root.paneKey,
          sessionId: root.native.sessionId,
          sessionFile: root.native.sessionFile,
          nativeReadyAt: root.readyAt,
          rendererAt: visible.at,
          latencyMs: Math.max(0, visible.at - root.readyAt)
        }
      })
      expect(Math.max(...startup.map((row) => row.latencyMs))).toBeLessThanOrEqual(10_000)
      report.startup = {
        roots: startup,
        latencyMs: latencyDistribution(startup.map((row) => row.latencyMs))
      }
      report.compact = await proveCompact(orcaPage, roots, testInfo)
      await orcaPage.waitForTimeout(750)
      const quietBefore = await readScalePaneStatuses(
        orcaPage,
        panes.map((pane) => pane.paneKey)
      )
      const observedBefore = await electronScaleSnapshot(electronApp)
      const quietSince = Date.now()
      await orcaPage.waitForTimeout(QUIET_MS)
      const quietUntil = Date.now()
      const observedAfter = await electronScaleSnapshot(electronApp)
      const quietAfter = await expectRootRosters(orcaPage, roots)
      const renderer = await readScaleRendererProbe(orcaPage)
      for (const snapshot of renderer.snapshots.filter(
        (row) => row.at >= quietSince && row.at <= quietUntil
      )) {
        expectStableRoot(snapshot.status, quietBefore[snapshot.paneKey]!)
      }
      const refresh = roots.map((root) => {
        expectStableRoot(quietAfter[root.paneKey], quietBefore[root.paneKey]!)
        expect(quietAfter[root.paneKey]!.updatedAt).toBeGreaterThan(
          quietBefore[root.paneKey]!.updatedAt
        )
        expectQuietNative(root, quietSince, quietUntil)
        const observed = quietRefreshEvidence(root.runtime.observations(), quietSince, quietUntil)
        expect(observed.count).toBeGreaterThanOrEqual(3)
        expect(observed.intervalsMs.max).toBeLessThanOrEqual(7500)
        const publications = renderer.freshness.filter(
          (row) => row.paneKey === root.paneKey && row.at >= quietSince && row.at <= quietUntil
        )
        const times = [quietSince, ...publications.map((row) => row.at), quietUntil]
        const rendererIntervals = latencyDistribution(
          times.slice(1).map((at, index) => at - times[index])
        )
        expect(rendererIntervals.max).toBeLessThanOrEqual(7500)
        return { paneKey: root.paneKey, native: observed, rendererIntervals }
      })
      const steadyLag = latencyDistribution(
        renderer.lag
          .filter((row) => row.at >= quietSince && row.at <= quietUntil)
          .map((row) => row.lagMs)
      )
      expect(steadyLag.count).toBeGreaterThan(100)
      expect(steadyLag.p95).toBeLessThanOrEqual(100)
      const observedMetrics = roots.map((root) =>
        nativeScaleWindow(root.runtime, quietSince, quietUntil)
      )
      report.steady = {
        since: quietSince,
        until: quietUntil,
        before: observedBefore,
        after: observedAfter,
        roots: observedMetrics,
        refresh,
        rendererLagMs: steadyLag,
        clocksBefore: quietBefore,
        clocksAfter: quietAfter
      }
      report.nativeAsyncPause = roots
        .filter((root) => root.asyncNames.length)
        .map((root) => ({
          paneKey: root.paneKey,
          asyncNames: root.asyncNames,
          refs: nativeChildren(root).filter((ref) => ref.pendingAsync),
          events: root.runtime
            .observations()
            .filter(
              (event) =>
                event.kind === 'extension' &&
                ((event.toolName === 'bash' && event.asyncJobId) ||
                  (event.agentKind === 'sub' && event.willContinue))
            )
        }))
      report.instrumentedWorkloadDelta = {
        scope: 'Observer plus differential test instrumentation; not tracker-only CPU attribution',
        perRoot: observedMetrics.map((row, index) => ({
          paneKey: roots[index]!.paneKey,
          nativeInstrumentedCpuPercentDelta: row.cpuPercent - controlMetrics[index]!.cpuPercent,
          nativeRssBytesDelta: row.rssBytes.last! - controlMetrics[index]!.rssBytes.last!,
          nativeListCallsDelta: row.registry.listCalls - controlMetrics[index]!.registry.listCalls,
          nativeListMsDelta: row.registry.listMs - controlMetrics[index]!.registry.listMs
        })),
        electronMainInstrumentedCpuPercentDelta:
          (observedAfter.main.cpu.user +
            observedAfter.main.cpu.system -
            (observedBefore.main.cpu.user + observedBefore.main.cpu.system)) /
            ((observedAfter.at - observedBefore.at) * 10) -
          (controlAfter.main.cpu.user +
            controlAfter.main.cpu.system -
            (controlBefore.main.cpu.user + controlBefore.main.cpu.system)) /
            ((controlAfter.at - controlBefore.at) * 10),
        electronMainRssBytesDelta: observedAfter.main.rssBytes - controlAfter.main.rssBytes,
        note: 'Enabled hooks additionally parse payloads, serialize/log observations and execute more registry timing wrappers. CPU deltas include that work, not tracker-only overhead. Sequential RSS includes retained app state; parent VM microbenchmarks separately isolate observer traversal.'
      }
      const changed = roots.filter((_, index) => index % 2 === 0)
      const unchanged = roots.filter((_, index) => index % 2 === 1)
      const burstSince = Date.now()
      const burstActions: NativeAction[] = []
      const removed = new Map<string, string[]>()
      await Promise.all(
        changed.map(async (root) => {
          const cancel = nativeChildren(root).find((ref) => ref.id.includes(names[1]!))!
          const complete = nativeChildren(root).find((ref) => ref.id.includes(names[0]!))!
          burstActions.push({
            paneKey: root.paneKey,
            sessionId: root.native.sessionId!,
            id: cancel.id,
            createdAt: cancel.createdAt,
            requestedAt: Date.now(),
            status: 'aborted'
          })
          burstActions.push({
            paneKey: root.paneKey,
            sessionId: root.native.sessionId!,
            id: complete.id,
            createdAt: complete.createdAt,
            requestedAt: Date.now(),
            status: 'completed'
          })
          await Promise.all([
            root.runtime
              .command('cancel_subagent', { subagentId: cancel.id })
              .then((response) => expect(response.data?.cancelled).toBe(true)),
            root.runtime.release(names[0]!)
          ])
          removed.set(root.paneKey, names.slice(0, 2))
        })
      )
      await expectRootRosters(orcaPage, roots, removed)
      await expect
        .poll(
          () =>
            burstActions.every((action) =>
              roots
                .find((root) => root.paneKey === action.paneKey)!
                .runtime.observations()
                .some(
                  (row) =>
                    row.kind === 'lifecycle' &&
                    row.id === action.id &&
                    row.status === action.status &&
                    row.at >= action.requestedAt
                )
            ),
          { timeout: 10_000 }
        )
        .toBe(true)
      const afterBurst = await readScalePaneStatuses(
        orcaPage,
        panes.map((pane) => pane.paneKey)
      )
      for (const root of unchanged) {
        expectStableRoot(afterBurst[root.paneKey], quietBefore[root.paneKey]!)
      }
      const burstRenderer = await readScaleRendererProbe(orcaPage)
      expect(
        burstRenderer.snapshots
          .filter((row) => row.at >= burstSince)
          .every((row) => row.status?.state === 'working')
      ).toBe(true)
      const burst = nativeTerminalConvergence(roots, burstActions, burstRenderer)
      const burstLatency = latencyDistribution(burst.map((row) => row.convergenceMs))
      expect(burstLatency.p95).toBeLessThanOrEqual(2500)
      report.burst = {
        since: burstSince,
        actions: burst,
        latencyMs: burstLatency,
        rendererLagMs: latencyDistribution(
          burstRenderer.lag.filter((row) => row.at >= burstSince).map((row) => row.lagMs)
        ),
        electron: await electronScaleSnapshot(electronApp),
        unchanged: unchanged.map((root) => root.paneKey)
      }
      const rebound = changed.filter((_, index) => index % 2 === 0)
      const nonRebound = roots.filter((root) => !rebound.includes(root))
      const rebindSince = Date.now()
      const nonReboundBefore = await readScalePaneStatuses(
        orcaPage,
        nonRebound.map((root) => root.paneKey)
      )
      const finishBeforeRebind = await finishRoots(orcaPage, rebound)
      const finishRenderer = await readScaleRendererProbe(orcaPage)
      const rebindCompletion = nativeTerminalConvergence(roots, finishBeforeRebind, finishRenderer)
      const reboundEvidence = await rebindRoots(orcaPage, rebound)
      report.rebind = reboundEvidence
      for (const root of rebound) {
        removed.delete(root.paneKey)
      }
      const afterRebind = await expectRootRosters(orcaPage, roots, removed)
      const rebindUntil = Date.now()
      const rebindRenderer = await readScaleRendererProbe(orcaPage)
      const nonReboundPanes = new Set(nonRebound.map((root) => root.paneKey))
      const isolatedSnapshots = rebindRenderer.snapshots.filter(
        (row) => nonReboundPanes.has(row.paneKey) && row.at >= rebindSince && row.at <= rebindUntil
      )
      for (const snapshot of isolatedSnapshots) {
        expectStableRoot(snapshot.status, nonReboundBefore[snapshot.paneKey]!)
      }
      for (const root of nonRebound) {
        expectStableRoot(afterRebind[root.paneKey], nonReboundBefore[root.paneKey]!)
      }
      report.rebindIsolation = {
        since: rebindSince,
        until: rebindUntil,
        baselines: nonReboundBefore,
        panes: [...nonReboundPanes],
        checkedSnapshots: isolatedSnapshots.length
      }
      for (const root of rebound) {
        const previousStarts = initial[root.paneKey]!.subagents.map((child) => child.startedAt)
        expect(
          afterRebind[root.paneKey]!.subagents.every(
            (child) => child.startedAt > Math.max(...previousStarts)
          )
        ).toBe(true)
      }
      for (const root of unchanged) {
        expectStableRoot(afterRebind[root.paneKey], quietBefore[root.paneKey]!)
      }
      await captureCompact(orcaPage, worktreeId, testInfo, 'native-scale-compact-after-rebind')
      const finalActions = await finishRoots(orcaPage, roots)
      const finalRenderer = await readScaleRendererProbe(orcaPage, true)
      probeInstalled = false
      const completion = [
        ...rebindCompletion,
        ...nativeTerminalConvergence(roots, finalActions, finalRenderer)
      ]
      const completionLatency = latencyDistribution(completion.map((row) => row.convergenceMs))
      expect(completionLatency.p95).toBeLessThanOrEqual(2500)
      expect(finalRenderer.dropped).toBe(0)
      const liveStarts = [
        ...startup.map((row) => ({
          paneKey: row.paneKey,
          sessionId: row.sessionId,
          since: row.rendererAt
        })),
        ...rebound.map((root) => {
          const admitted = finalRenderer.snapshots.find(
            (row) =>
              row.paneKey === root.paneKey &&
              row.status !== null &&
              row.status.providerSession?.id === root.native.sessionId &&
              row.status.subagents.length === root.names.length
          )
          if (!admitted) {
            throw new Error('Missing rebound roster admission evidence')
          }
          return { paneKey: root.paneKey, sessionId: root.native.sessionId, since: admitted.at }
        })
      ]
      report.livePresence = liveStarts.map((window) => {
        const terminals = completion.filter(
          (action) => action.paneKey === window.paneKey && action.sessionId === window.sessionId
        )
        expect(terminals.length).toBeGreaterThan(0)
        const until = Math.max(...terminals.map((action) => action.nativeTransitionAt))
        expect(
          finalRenderer.snapshots.filter(
            (row) =>
              row.paneKey === window.paneKey &&
              row.at >= window.since &&
              row.at < until &&
              row.status === null
          ),
          'A root disappeared before all its remaining native children terminalized'
        ).toEqual([])
        return { ...window, until }
      })
      const finalElectron = await electronScaleSnapshot(electronApp)
      expect(finalElectron.hidden).toBe(true)
      report.completion = {
        actions: completion,
        latencyMs: completionLatency,
        electron: finalElectron
      }
      report.renderer = finalRenderer
      report.final = await readScalePaneStatuses(
        orcaPage,
        panes.map((pane) => pane.paneKey)
      )
      report.http = roots.map((root) => ({
        directory: root.runtime.directory,
        ...nativeScaleWindow(root.runtime, quietSince, Date.now()).http
      }))
      report.baseline = baseline
      report.completed = true
    } finally {
      // All starts settle before returning; both failed startup and assertion failures own every native process.
      await Promise.allSettled([...owned].map((runtime) => runtime.stop()))
      if (probeInstalled) {
        try {
          report.rendererOnFailure = await readScaleRendererProbe(orcaPage, true)
        } catch {
          report.rendererOnFailure = 'Renderer unavailable during teardown'
        }
      }
      const file = testInfo.outputPath('native-scale-metrics.json')
      await writeFile(file, JSON.stringify(report, null, 2))
      await testInfo.attach('native-scale-metrics', { path: file, contentType: 'application/json' })
    }
  })
}
