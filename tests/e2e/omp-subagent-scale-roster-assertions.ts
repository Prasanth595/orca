import type { Page } from '@stablyai/playwright-test'
import { expect } from './helpers/orca-app'
import { nativeChildren, type ScaleRoot } from './omp-subagent-scale-roots'
import {
  readScalePaneStatuses,
  readScaleRendererProbe,
  type ScalePaneStatus
} from './omp-subagent-scale-metrics'

export { expectUnpromptedRoots, expectRootRosters, expectStableRoot, expectQuietNative }
async function expectUnpromptedRoots(page: Page, roots: ScaleRoot[], initial = false) {
  const since = Date.now()
  await page.waitForTimeout(6500)
  const statuses = await readScalePaneStatuses(
    page,
    roots.map((root) => root.paneKey)
  )
  const renderer = await readScaleRendererProbe(page)
  const panes = new Set(roots.map((root) => root.paneKey))
  expect(
    renderer.snapshots
      .filter((row) => panes.has(row.paneKey) && row.at >= since)
      .every((row) => row.status?.state !== 'working' && (row.status?.subagents.length ?? 0) === 0)
  ).toBe(true)
  for (const root of roots) {
    const row = statuses[root.paneKey]
    expect(row?.state).not.toBe('working')
    expect(row?.subagents ?? []).toHaveLength(0)
    if (!row || row.providerSession?.id === root.native.sessionId) {
      expect(row?.turnStartedAt).toBeUndefined()
    }
    const observations = root.runtime.observations().filter((entry) => entry.at >= root.native.at)
    expect(observations.filter((entry) => entry.kind === 'model-request')).toEqual([])
    expect(
      observations.filter(
        (entry) =>
          entry.kind === 'hook' &&
          entry.sessionId === root.native.sessionId &&
          entry.rootState === 'working'
      )
    ).toEqual([])
    if (initial) {
      expect(
        observations.some(
          (entry) =>
            entry.kind === 'registry' &&
            entry.refs?.some(
              (ref) => ref.rootManager && ref.kind === 'main' && ref.status === 'running'
            )
        )
      ).toBe(true)
    }
  }
  return { since, until: Date.now(), statuses, nativeRoots: roots.map((root) => root.native) }
}
async function expectRootRosters(
  page: Page,
  roots: ScaleRoot[],
  removed = new Map<string, string[]>()
) {
  await expect
    .poll(
      async () => {
        const statuses = await readScalePaneStatuses(
          page,
          roots.map((root) => root.paneKey)
        )
        return roots.every((root) => {
          const row = statuses[root.paneKey]
          const expected = nativeChildren(root)
            .map((ref) => ref.id)
            .sort()
          const names = root.names.filter((name) => !removed.get(root.paneKey)?.includes(name))
          return (
            row?.state === 'working' &&
            row.prompt === root.label &&
            row.toolName === 'wait' &&
            row.providerSession?.id === root.native.sessionId &&
            row.subagents.length === names.length &&
            row.subagents
              .map((child) => child.id)
              .sort()
              .join('|') === expected.join('|') &&
            names.every((name) => row.subagents.some((child) => child.id.includes(name)))
          )
        })
      },
      {
        timeout: 10_000,
        intervals: [50, 100, 200],
        message: 'RootStore did not converge to each exact native roster'
      }
    )
    .toBe(true)
  const statuses = await readScalePaneStatuses(
    page,
    roots.map((root) => root.paneKey)
  )
  for (const root of roots) {
    const status = statuses[root.paneKey]!
    const refs = nativeChildren(root)
    expect(status.providerSession?.transcriptPath).toBe(root.native.sessionFile)
    expect(status.subagents.every((child) => child.state === 'working')).toBe(true)
    expect(JSON.stringify(status.subagents)).not.toContain('MODEL_ONLY_')
    for (const child of status.subagents) {
      expect(child.startedAt).toBe(refs.find((ref) => ref.id === child.id)?.createdAt)
      expect(child.description).toBe(child.id)
    }
    for (const name of root.asyncNames) {
      const ref = refs.find((candidate) => candidate.id.includes(name))
      expect(ref).toMatchObject({ status: 'idle', isStreaming: false, pendingAsync: true })
      expect(
        root.runtime
          .observations()
          .some(
            (event) =>
              event.kind === 'extension' &&
              event.name === 'agent_end' &&
              event.agentKind === 'sub' &&
              event.sessionId === ref?.sessionId &&
              event.willContinue === true
          )
      ).toBe(true)
      expect(
        root.runtime
          .observations()
          .some(
            (event) =>
              event.kind === 'extension' &&
              event.toolName === 'bash' &&
              event.asyncJobId &&
              event.asyncState === 'running' &&
              event.sessionId === ref?.sessionId
          )
      ).toBe(true)
      expect(
        root.runtime
          .observations()
          .filter(
            (event) =>
              event.kind === 'native-terminal' &&
              event.id === ref?.id &&
              event.createdAt === ref?.createdAt &&
              event.at >= root.native.at
          )
      ).toEqual([])
    }
    expect(root.runtime.observations().filter((row) => row.kind === 'network-blocked')).toEqual([])
    const hooks = root.runtime
      .observations()
      .filter((row) => row.kind === 'hook' && row.at >= root.native.at)
    expect(hooks.every((row) => row.accepted && row.sessionId === root.native.sessionId)).toBe(true)
    const opening = hooks.findLast((row) => row.hookEvent === 'before_agent_start')
    if (opening) {
      expect(status.turnStartedAt).toBeGreaterThanOrEqual(root.native.at)
      expect(status.turnStartedAt).toBeLessThanOrEqual(status.updatedAt)
    } else {
      expect(status.turnStartedAt).toBeUndefined()
    }
  }
  return statuses
}

function expectStableRoot(actual: ScalePaneStatus | null, before: ScalePaneStatus) {
  expect(actual, 'A live root must not disappear from RootStore').not.toBeNull()
  expect(actual).toMatchObject({
    state: before.state,
    prompt: before.prompt,
    toolName: before.toolName,
    toolInput: before.toolInput,
    stateStartedAt: before.stateStartedAt,
    turnStartedAt: before.turnStartedAt,
    stateHistory: before.stateHistory,
    lastAssistantMessage: before.lastAssistantMessage,
    providerSession: before.providerSession,
    subagents: before.subagents
  })
}

function expectQuietNative(root: ScaleRoot, since: number, until: number) {
  const rows = root.runtime.observations().filter((row) => row.at >= since && row.at <= until)
  expect(rows.filter((row) => row.kind === 'model-request')).toEqual([])
  expect(
    rows.filter(
      (row) =>
        row.kind === 'extension' &&
        row.agentKind === 'main' &&
        [
          'before_agent_start',
          'agent_start',
          'tool_execution_start',
          'tool_execution_end',
          'agent_end'
        ].includes(row.name ?? '')
    )
  ).toEqual([])
}
