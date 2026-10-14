import type { TestInfo } from '@stablyai/playwright-test'
import type { AgentHookEndpoint } from '../../src/shared/agent-hook-endpoint-file'
import { expect } from './helpers/orca-app'
import { deterministicProviderSource } from './helpers/omp-deterministic-provider'
import type { NativeObservation, NativeRef } from './helpers/omp-native-observation'
import { startOmpStatusRuntime, type OmpStatusRuntime } from './helpers/omp-subagent-status-runtime'
import type { ActivePaneHookDescriptor } from './helpers/terminal'

export { nativeRoot, nativeChildren, waitNativeChildren, startRoots }
export type { ScaleRoot, NativeAction }
type ScaleRoot = ActivePaneHookDescriptor & {
  runtime: OmpStatusRuntime
  label: string
  names: string[]
  asyncNames: string[]
  native: NativeObservation
  readyAt: number
}
type NativeAction = {
  paneKey: string
  sessionId: string
  id: string
  createdAt?: number
  requestedAt: number
  status: 'aborted' | 'completed'
}
function nativeRoot(runtime: OmpStatusRuntime): NativeObservation {
  const root = runtime
    .observations()
    .findLast((row) => row.kind === 'context' && row.agentKind === 'main')
  if (!root?.sessionId || !root.ownerMatches) {
    throw new Error(`No exact native root manager: ${runtime.directory}`)
  }
  return root
}

function nativeChildren(root: ScaleRoot): NativeRef[] {
  const snapshot = root.runtime
    .observations()
    .findLast((row) => row.kind === 'registry' && row.sessionId === root.native.sessionId)
  if (!snapshot?.ownerMatches) {
    throw new Error(`No owned native registry snapshot: ${root.runtime.directory}`)
  }
  return (snapshot.refs ?? []).filter(
    (ref) =>
      ref.kind === 'sub' &&
      ref.parentId === root.native.id &&
      ((ref.status === 'running' && ref.isStreaming === true) || ref.pendingAsync === true)
  )
}

async function waitNativeChildren(roots: ScaleRoot[]): Promise<void> {
  await expect
    .poll(
      () =>
        roots.every((root) => {
          const held = root.runtime
            .observations()
            .filter(
              (row) =>
                ['model-held', 'async-model-settled'].includes(row.kind) && row.at >= root.native.at
            )
          const refs = nativeChildren(root)
          return (
            new Set(held.map((row) => row.name)).size === root.names.length &&
            refs.length === root.names.length &&
            root.asyncNames.every((name) =>
              refs.some(
                (ref) =>
                  ref.id.includes(name) &&
                  ref.status === 'idle' &&
                  ref.isStreaming === false &&
                  ref.pendingAsync === true
              )
            )
          )
        }),
      {
        timeout: 90_000,
        message: 'Installed native scheduler did not admit the complete concurrent workload'
      }
    )
    .toBe(true)
  for (const root of roots) {
    const rows = root.runtime.observations()
    const held = rows.filter(
      (row) => ['model-held', 'async-model-settled'].includes(row.kind) && row.at >= root.native.at
    )
    expect([...new Set(held.map((row) => row.name))].sort()).toEqual([...root.names].sort())
    root.readyAt = Math.max(...held.map((row) => row.at))
    const contexts = rows.filter(
      (row) => row.kind === 'context' && row.agentKind === 'sub' && row.at >= root.native.at
    )
    expect(contexts).toHaveLength(root.names.length)
    expect(
      contexts.every((row) => row.ownerMatches && row.sessionId !== root.native.sessionId)
    ).toBe(true)
    expect(new Set(contexts.map((row) => row.sessionId)).size).toBe(root.names.length)
    expect(
      nativeChildren(root).every((ref) => contexts.some((row) => row.sessionId === ref.sessionId))
    ).toBe(true)
  }
}
async function startRoots(options: {
  panes: ActivePaneHookDescriptor[]
  names: string[]
  endpoint: AgentHookEndpoint
  observerEnabled: boolean
  testInfo: TestInfo
  owned: Set<OmpStatusRuntime>
  beforePrompt?: (roots: ScaleRoot[]) => Promise<void>
}): Promise<ScaleRoot[]> {
  const settled = await Promise.allSettled(
    options.panes.map(async (pane, index) => {
      const label = `Native OMP scale root ${String(index + 1).padStart(2, '0')}`
      const asyncNames = index % 4 === 0 ? [options.names[2]!] : []
      const runtime = await startOmpStatusRuntime({
        ...pane,
        directory: options.testInfo.outputPath(
          `${options.observerEnabled ? 'observed' : 'control'}-${index + 1}`
        ),
        fixtureSource: deterministicProviderSource,
        rootLabel: label,
        names: options.names,
        endpoint: options.endpoint,
        maxConcurrency: options.names.length,
        observerEnabled: options.observerEnabled,
        measurements: true,
        asyncChildNames: asyncNames
      })
      options.owned.add(runtime)
      return {
        ...pane,
        label,
        runtime,
        names: options.names,
        asyncNames,
        native: nativeRoot(runtime),
        readyAt: 0
      }
    })
  )
  const failure = settled.find((result) => result.status === 'rejected')
  if (failure?.status === 'rejected') {
    throw failure.reason
  }
  const roots = settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
  await options.beforePrompt?.(roots)
  await Promise.all(roots.map((root) => root.runtime.command('prompt', { message: root.label })))
  await waitNativeChildren(roots)
  await Promise.all(
    roots.map(async (root) => {
      const state = (await root.runtime.command('get_state')).data
      expect(state?.sessionId).toBe(root.native.sessionId)
      expect(state?.sessionFile).toBeTruthy()
      root.native.sessionFile = state?.sessionFile
    })
  )
  expect(new Set(roots.map((root) => root.native.sessionId)).size).toBe(roots.length)
  expect(new Set(roots.map((root) => root.native.sessionFile)).size).toBe(roots.length)
  return roots
}
