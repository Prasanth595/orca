import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import type { AgentStatusEntry } from '../../src/shared/agent-status-types'
import type { AppState } from '../../src/renderer/src/store/types'
import type { NativeObservation } from './helpers/omp-native-observation'
import type { OmpStatusRuntime } from './helpers/omp-subagent-status-runtime'

export type ScalePaneStatus = Pick<
  AgentStatusEntry,
  | 'state'
  | 'prompt'
  | 'toolName'
  | 'toolInput'
  | 'updatedAt'
  | 'stateStartedAt'
  | 'turnStartedAt'
  | 'stateHistory'
  | 'lastAssistantMessage'
  | 'providerSession'
> & { subagents: NonNullable<AgentStatusEntry['subagents']> }
export type ScaleRendererEvidence = {
  snapshots: { at: number; paneKey: string; status: ScalePaneStatus | null }[]
  freshness: { at: number; paneKey: string; updatedAt: number }[]
  lag: { at: number; lagMs: number }[]
  dropped: number
}
type RendererProbe = ScaleRendererEvidence & { stop: () => void }
declare global {
  var __ompNativeScaleProbe: RendererProbe | undefined
}

/** Observe the existing RootStore; never inject status or create another tracker. */
export async function startScaleRendererProbe(page: Page, paneKeys: string[]): Promise<void> {
  await page.evaluate((keys) => {
    const host = globalThis
    host.__ompNativeScaleProbe?.stop()
    const store = window.__store
    if (!store) {
      throw new Error('RootStore is unavailable')
    }
    const evidence: RendererProbe = {
      snapshots: [],
      freshness: [],
      lag: [],
      dropped: 0,
      stop: () => {
        clearInterval(timer)
        unsubscribe()
      }
    }
    const signatures = new Map<string, string>()
    const observe = (next: AppState, previous?: AppState) => {
      for (const paneKey of keys) {
        const row = next.agentStatusByPaneKey[paneKey]
        if (row === previous?.agentStatusByPaneKey[paneKey]) {
          continue
        }
        const at = Date.now()
        if (!row) {
          signatures.delete(paneKey)
          if (evidence.snapshots.length < 4096) {
            evidence.snapshots.push({ at, paneKey, status: null })
          } else {
            evidence.dropped++
          }
          continue
        }
        if (evidence.freshness.length < 16_384) {
          evidence.freshness.push({ at, paneKey, updatedAt: row.updatedAt })
        } else {
          evidence.dropped++
        }
        const children = row.subagents ?? []
        const signature = [
          row.providerSession?.id,
          row.providerSession?.transcriptPath,
          row.state,
          row.prompt,
          row.toolName,
          row.toolInput,
          row.lastAssistantMessage,
          row.stateStartedAt,
          row.turnStartedAt,
          ...children.map(
            (child) =>
              `${child.id}:${child.agentType}:${child.description}:${child.state}:${child.startedAt}`
          )
        ].join('|')
        if (
          signatures.get(paneKey) === signature &&
          row.stateHistory === previous?.agentStatusByPaneKey[paneKey]?.stateHistory
        ) {
          continue
        }
        signatures.set(paneKey, signature)
        if (evidence.snapshots.length >= 4096) {
          evidence.dropped++
          continue
        }
        evidence.snapshots.push({
          at,
          paneKey,
          status: {
            state: row.state,
            prompt: row.prompt,
            toolName: row.toolName,
            toolInput: row.toolInput,
            updatedAt: row.updatedAt,
            stateStartedAt: row.stateStartedAt,
            turnStartedAt: row.turnStartedAt,
            stateHistory: row.stateHistory,
            lastAssistantMessage: row.lastAssistantMessage,
            providerSession: row.providerSession,
            subagents: children
          }
        })
      }
    }
    observe(store.getState())
    const unsubscribe = store.subscribe((next, previous) => observe(next, previous))
    let previous = performance.now()
    const timer = setInterval(() => {
      const now = performance.now()
      if (evidence.lag.length < 16_384) {
        evidence.lag.push({ at: Date.now(), lagMs: Math.max(0, now - previous - 50) })
      } else {
        evidence.dropped++
      }
      previous = now
    }, 50)
    host.__ompNativeScaleProbe = evidence
  }, paneKeys)
}

export async function readScaleRendererProbe(
  page: Page,
  stop = false
): Promise<ScaleRendererEvidence> {
  return page.evaluate((shouldStop) => {
    const probe = globalThis.__ompNativeScaleProbe
    if (!probe) {
      throw new Error('Native scale renderer probe was not installed')
    }
    if (shouldStop) {
      probe.stop()
    }
    return {
      snapshots: probe.snapshots,
      freshness: probe.freshness,
      lag: probe.lag,
      dropped: probe.dropped
    }
  }, stop)
}

export async function readScalePaneStatuses(
  page: Page,
  paneKeys: string[]
): Promise<Record<string, ScalePaneStatus | null>> {
  return page.evaluate((keys) => {
    const state = window.__store!.getState()
    return Object.fromEntries(
      keys.map((key) => {
        const row = state.agentStatusByPaneKey[key]
        return [
          key,
          row
            ? {
                state: row.state,
                prompt: row.prompt,
                toolName: row.toolName,
                toolInput: row.toolInput,
                updatedAt: row.updatedAt,
                stateStartedAt: row.stateStartedAt,
                turnStartedAt: row.turnStartedAt,
                stateHistory: row.stateHistory,
                lastAssistantMessage: row.lastAssistantMessage,
                providerSession: row.providerSession,
                subagents: row.subagents ?? []
              }
            : null
        ]
      })
    )
  }, paneKeys)
}

export async function electronScaleSnapshot(app: ElectronApplication) {
  return app.evaluate(({ app, BrowserWindow }) => {
    const rendererPid = BrowserWindow.getAllWindows()[0]?.webContents.getOSProcessId()
    const renderer = app.getAppMetrics().find((metric) => metric.pid === rendererPid)
    return {
      at: Date.now(),
      main: { pid: process.pid, cpu: process.cpuUsage(), rssBytes: process.memoryUsage.rss() },
      renderer: renderer
        ? {
            pid: renderer.pid,
            cpu: renderer.cpu,
            workingSetBytes: renderer.memory.workingSetSize * 1024
          }
        : null,
      hidden: BrowserWindow.getAllWindows().every((window) => !window.isVisible())
    }
  })
}

export function latencyDistribution(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right)
  return {
    count: sorted.length,
    p50: sorted.length ? sorted[Math.ceil(sorted.length * 0.5) - 1] : null,
    p95: sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null,
    max: sorted.at(-1) ?? null
  }
}

export function nativeScaleWindow(runtime: OmpStatusRuntime, since: number, until: number) {
  const rows = runtime.observations()
  const samples = rows.filter((row) => row.kind === 'native-metrics')
  const first = samples.findLast((row) => row.at <= since)
  const last = samples.findLast((row) => row.at <= until)
  if (!first || !last || last.at <= first.at) {
    throw new Error(`No native CPU/registry measurement window: ${runtime.directory}`)
  }
  const hooks = rows.filter((row) => row.kind === 'hook' && row.at >= since && row.at <= until)
  const elapsedMs = last.at - first.at
  return {
    directory: runtime.directory,
    pid: last.pid,
    since: first.at,
    until: last.at,
    elapsedMs,
    cpuMicros:
      last.cpuUserMicros! + last.cpuSystemMicros! - (first.cpuUserMicros! + first.cpuSystemMicros!),
    cpuPercent:
      (last.cpuUserMicros! +
        last.cpuSystemMicros! -
        (first.cpuUserMicros! + first.cpuSystemMicros!)) /
      (elapsedMs * 10),
    rssBytes: {
      first: first.rssBytes,
      last: last.rssBytes,
      max: Math.max(
        ...samples
          .filter((row) => row.at >= first.at && row.at <= last.at)
          .map((row) => row.rssBytes!)
      )
    },
    registry: {
      listCalls: last.listCalls! - first.listCalls!,
      listMs: last.listMs! - first.listMs!,
      getCalls: last.getCalls! - first.getCalls!,
      getMs: last.getMs! - first.getMs!,
      changes: last.registryChanges! - first.registryChanges!
    },
    http: {
      posts: hooks.length,
      accepted: hooks.filter((row) => row.accepted).length,
      bytes: hooks.reduce((total, row) => total + (row.bytes ?? 0), 0),
      admissionMs: latencyDistribution(hooks.map((row) => row.durationMs!))
    }
  }
}

export function quietRefreshEvidence(rows: NativeObservation[], since: number, until: number) {
  const hooks = rows.filter(
    (row) =>
      row.kind === 'hook' &&
      row.accepted &&
      row.hookEvent === 'subagents_update' &&
      row.at >= since &&
      row.at <= until
  )
  const times = [since, ...hooks.map((row) => row.at), until]
  return {
    count: hooks.length,
    timestamps: hooks.map((row) => row.at),
    intervalsMs: latencyDistribution(times.slice(1).map((at, index) => at - times[index]))
  }
}
