import { writeFile } from 'node:fs/promises'
import type { Locator, Page, TestInfo } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { readHookEndpoint } from './helpers/agent-hook-endpoint'
import type { NativeObservation } from './helpers/omp-native-observation'
import { startOmpStatusRuntime, type OmpStatusRuntime } from './helpers/omp-subagent-status-runtime'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActiveTerminalManager } from './helpers/terminal'
import { worktreeRow } from './worktree-row-locators'

// Capability-detected native registry; verified OMP baseline: 18.10.3. No login/model service.
// ORCA_BACKGROUND_LAUNCH=1 ORCA_REAL_OMP_CLI_TEST=1 pnpm run test:e2e omp-subagent-status.spec.ts --workers=1
// Optional ORCA_OMP_PROOF_BINARY=/absolute/path/to/omp; globalSetup builds the e2e app unless SKIP_BUILD=1.
// Sidebar-only screenshots, native observations, RPC output and generated extension stay in test-results/.
test.skip(
  process.env.ORCA_REAL_OMP_CLI_TEST !== '1',
  'Opt-in installed OMP scheduler/renderer smoke'
)
test.use({ minimumSeededWorktreeCount: 1 })
test.beforeAll(() => {
  if (process.env.ORCA_BACKGROUND_LAUNCH !== '1' || process.env.ORCA_E2E_FORCE_HEADFUL === '1') {
    throw new Error(
      'Native OMP smoke requires ORCA_BACKGROUND_LAUNCH=1 and the hidden renderer fixture'
    )
  }
})

// Only provider output is fabricated. Task/wait execution, refs, events and hook payloads are native.
const deterministicProviderSource = String.raw`
import { appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createAssistantMessageEventStream } from '@oh-my-pi/pi-ai';
const names = JSON.parse(process.env.ORCA_OMP_SMOKE_NAMES);
const rootLabel = process.env.ORCA_OMP_SMOKE_ROOT_LABEL;
const gates = process.env.ORCA_OMP_SMOKE_GATES;
const observationPath = process.env.ORCA_OMP_SMOKE_OBSERVATIONS;
let callSerial = 0;
const managers = new WeakMap();
let managerSerial = 0;
let activeRootLabel = rootLabel;
let snapshotRootRegistry;
function record(kind, fields = {}) {
  appendFileSync(observationPath, JSON.stringify({ at: Date.now(), kind, ...fields }) + '\n');
}
const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname !== '127.0.0.1' || url.port !== process.env.ORCA_AGENT_HOOK_PORT || url.pathname !== '/hook/omp') {
    record('network-blocked', { name: url.origin });
    throw new Error('OMP smoke forbids external network');
  }
  const payload = JSON.parse(options.body).payload;
  const response = await nativeFetch(input, options);
  record('hook', { accepted: response.status === 204, hookEvent: payload.hook_event_name,
    sessionId: payload.session_id, sessionFile: payload.session_file, subagents: payload.subagents,
    rootState: payload.omp_status?.state, rootToolName: payload.omp_status?.tool_name,
    rootPrompt: payload.omp_status?.prompt, rootText: payload.omp_status?.text,
    rootBoundary: payload.omp_status?.session_boundary === true });
  return response;
};
function waitForRelease(name, signal) {
  const { promise, resolve, reject } = Promise.withResolvers();
  const started = Date.now();
  const finish = aborted => { clearInterval(timer); signal?.removeEventListener('abort', abort); resolve(aborted); };
  const abort = () => finish(true);
  const timer = setInterval(() => {
    if (existsSync(path.join(gates, name))) finish(false);
    else if (Date.now() - started > 120000) {
      clearInterval(timer); signal?.removeEventListener('abort', abort);
      reject(new Error('Deterministic child was never released'));
    }
  }, 100);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  return promise;
}
export default function(api) {
  const registry = api.pi?.AgentRegistry?.global?.();
  if (!registry || !['list', 'get', 'onChange'].every(key => typeof registry[key] === 'function')) {
    throw new Error('Installed OMP must export its actual AgentRegistry global/list/get/onChange');
  }
  let ownerKind;
  let unsubscribe;
  for (const name of ['session_start', 'session_switch']) api.on(name, (_event, ctx) => {
    ownerKind = ctx.agent?.kind;
    const manager = ctx.sessionManager;
    if (!managers.has(manager)) managers.set(manager, ++managerSerial);
    const ownRef = registry.get(ctx.agent?.id);
    const ownerMatches = ownRef?.session?.sessionManager === manager;
    record('context', { name, agentKind: ownerKind, id: ctx.agent?.id, managerId: managers.get(manager),
      sessionId: manager.getSessionId(), sessionFile: manager.getSessionFile(), ownerMatches });
    if (ownerKind !== 'main') return;
    const snapshot = () => record('registry', { sessionId: manager.getSessionId(),
      ownerMatches: registry.get(ctx.agent.id)?.session?.sessionManager === manager,
      refs: registry.list().map(ref => ({ id: ref.id, kind: ref.kind, parentId: ref.parentId,
        status: ref.status, createdAt: ref.createdAt, sessionId: ref.session?.sessionManager?.getSessionId?.(),
        sessionFile: ref.sessionFile, rootManager: ref.session?.sessionManager === manager }))
    });
    unsubscribe?.();
    snapshotRootRegistry = snapshot;
    unsubscribe = registry.onChange(snapshot);
    snapshot();
  });
  api.on('session_shutdown', () => unsubscribe?.());
  for (const name of ['before_agent_start', 'agent_start', 'tool_execution_start', 'tool_execution_end', 'agent_end']) {
    api.on(name, (event, ctx) => {
      if (ctx.agent?.kind === 'main' && name === 'before_agent_start' &&
          typeof event.prompt === 'string' && event.prompt.startsWith('Native OMP ')) activeRootLabel = event.prompt;
      record('extension', { name, toolName: event.toolName,
        agentKind: ctx.agent?.kind, sessionId: ctx.sessionManager.getSessionId() });
      // Native attachSession is silent; inspect the actual registry after native sessions start.
      if (name === 'agent_start') snapshotRootRegistry?.();
    });
  }
  api.events.on('task:subagent:lifecycle', event => {
    if (ownerKind === 'main') record('lifecycle', { id: event.id, status: event.status });
  });
  api.on('before_subagent_spawn', () => ({ model: 'orca-status-smoke/deterministic' }));
  api.registerProvider('orca-status-smoke', {
    api: 'orca-status-smoke-api', apiKey: 'offline-smoke-not-a-credential',
    baseUrl: 'http://127.0.0.1/never-used',
    models: ['deterministic', 'label'].map(id => ({ id, name: 'Deterministic native status smoke', reasoning: false,
      input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 131072, maxTokens: 2048 })),
    streamSimple(model, context, options = {}) {
      const stream = createAssistantMessageEventStream();
      void (async () => {
        const root = model.id === 'deterministic' && (context.tools ?? []).some(tool => tool.name === 'task');
        const spawned = context.messages.some(message => message.role === 'assistant' &&
          Array.isArray(message.content) && message.content.some(part => part.type === 'toolCall' && part.name === 'task'));
        const userText = context.messages.filter(message => message.role === 'user')
          .map(message => typeof message.content === 'string' ? message.content : JSON.stringify(message.content)).join('\n');
        const namedTask = names.find(name => userText.includes('OMP_SMOKE_CHILD=' + name));
        const childName = model.id === 'deterministic' && !root ? namedTask : undefined;
        if (model.id === 'label') record('auxiliary-model', { name: namedTask, sessionId: options.sessionId });
        let aborted = false;
        const message = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: 'stop', timestamp: Date.now() };
        stream.push({ type: 'start', partial: message });
        if (root && !spawned && !existsSync(path.join(gates, 'root-start'))) {
          record('root-model-held');
          aborted = await waitForRelease('root-start', options.signal);
        }
        if (!aborted && root && (!spawned || !existsSync(path.join(gates, 'root-finish')))) {
          const part = { type: 'toolCall', id: 'native-status-' + ++callSerial,
            name: spawned ? 'wait' : 'task', arguments: spawned ? {} : {
              context: 'Deterministic native scheduler smoke for ' + activeRootLabel,
              tasks: names.map(name => ({ name, agent: 'status-smoke',
                task: 'OMP_SMOKE_CHILD=' + name + ' MODEL_ONLY_INSTRUCTION: return deterministic text.',
                solutionSpace: 'one fixed response' }))
            } };
          message.content.push(part);
          stream.push({ type: 'toolcall_start', contentIndex: 0, partial: message });
          stream.push({ type: 'toolcall_end', contentIndex: 0, toolCall: part, partial: message });
          message.stopReason = 'toolUse';
        } else {
          const part = { type: 'text', text: '' };
          message.content.push(part);
          stream.push({ type: 'text_start', contentIndex: 0, partial: message });
          const emit = delta => {
            part.text += delta;
            stream.push({ type: 'text_delta', contentIndex: 0, delta, partial: message });
          };
          emit(model.id === 'label' ? '<title>' + (namedTask ?? activeRootLabel) + '</title>' :
            childName ? 'MODEL_ONLY_CHILD_PREVIEW: ' + childName : activeRootLabel);
          if (childName && !root) {
            record('model-held', { name: childName, sessionId: options.sessionId });
            aborted = await waitForRelease(childName, options.signal);
            if (!aborted) emit(' completed.');
          }
          stream.push({ type: 'text_end', contentIndex: 0, content: part.text, partial: message });
          if (aborted) message.stopReason = 'aborted';
        }
        if (aborted) {
          message.errorMessage = 'Native cancellation reached the deterministic provider';
          stream.push({ type: 'error', reason: 'aborted', error: message });
        } else stream.push({ type: 'done', reason: message.stopReason, message });
        stream.end(message);
      })().catch(error => stream.fail(error));
      return stream;
    }
  });
}
`

function rowWithLabel(page: Page, rows: Locator, label: string): Locator {
  return rows.filter({ has: page.locator('span[title]').filter({ hasText: label }) })
}

function readPaneStatus(page: Page, paneKey: string) {
  return page.evaluate((key) => {
    const row = window.__store?.getState().agentStatusByPaneKey[key]
    return row
      ? {
          state: row.state,
          prompt: row.prompt,
          toolName: row.toolName,
          lastAssistantMessage: row.lastAssistantMessage,
          updatedAt: row.updatedAt,
          stateStartedAt: row.stateStartedAt,
          turnStartedAt: row.turnStartedAt,
          stateHistory: row.stateHistory,
          subagents: row.subagents ?? []
        }
      : null
  }, paneKey)
}

function nativeRoot(runtime: OmpStatusRuntime): NativeObservation {
  const root = runtime
    .observations()
    .findLast((row) => row.kind === 'context' && row.agentKind === 'main')
  if (!root?.sessionId || !root.ownerMatches) {
    throw new Error(
      `The exported native registry did not prove exact root-manager ownership: ${runtime.directory}`
    )
  }
  return root
}

function expectReboundTurnClock(
  status: { turnStartedAt?: number; updatedAt: number },
  scopedHooks: NativeObservation[],
  root: NativeObservation,
  previousClock: number | undefined
): void {
  const opening = scopedHooks.findLast((row) => row.hookEvent === 'before_agent_start')
  if (opening) {
    expect(status.turnStartedAt).toBeGreaterThanOrEqual(root.at)
    expect(status.turnStartedAt).toBeGreaterThan(previousClock ?? 0)
    expect(status.turnStartedAt).toBeLessThanOrEqual(status.updatedAt)
  } else {
    // agent_start and authoritative snapshots are not turn-opening evidence.
    expect(status.turnStartedAt).toBeUndefined()
  }
}

async function capture(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const file = testInfo.outputPath(`${name}.png`)
  await page.locator('[data-worktree-sidebar]').first().screenshot({ path: file })
  await testInfo.attach(name, { path: file, contentType: 'image/png' })
}

async function expandNativeChildren(row: Locator): Promise<void> {
  const disclosure = row.locator('[data-agent-child-disclosure-button]')
  await expect(disclosure).toBeVisible()
  if ((await disclosure.getAttribute('aria-expanded')) === 'false') {
    await disclosure.click()
  }
}

async function expectNativeChildren(runtime: OmpStatusRuntime, names: string[]): Promise<void> {
  const root = nativeRoot(runtime)
  await expect
    .poll(
      () =>
        runtime
          .observations()
          .filter((row) => row.kind === 'model-held' && row.at >= root.at)
          .map((row) => row.name)
          .sort(),
      { timeout: 30_000 }
    )
    .toEqual([...names].sort())
  await expect
    .poll(
      () =>
        runtime
          .observations()
          .findLast((row) => row.kind === 'registry' && row.sessionId === root.sessionId)
          ?.refs?.filter((ref) => ref.kind === 'sub' && ref.status === 'running').length
    )
    .toBe(names.length)
  const contexts = runtime
    .observations()
    .filter((row) => row.kind === 'context' && row.agentKind === 'sub' && row.at >= root.at)
  expect(contexts).toHaveLength(names.length)
  expect(contexts.every((row) => row.ownerMatches && row.sessionId !== root.sessionId)).toBe(true)
  const childSessions = new Set(contexts.map((row) => row.sessionId))
  expect(childSessions.size).toBe(names.length)
  const refs =
    runtime
      .observations()
      .findLast((row) => row.kind === 'registry' && row.sessionId === root.sessionId)?.refs ?? []
  expect(refs.filter((ref) => ref.rootManager).map((ref) => ref.id)).toEqual([root.id])
  for (const name of names) {
    expect(
      refs.some(
        (ref) =>
          ref.kind === 'sub' &&
          ref.status === 'running' &&
          ref.parentId === root.id &&
          ref.id.includes(name) &&
          childSessions.has(ref.sessionId)
      )
    ).toBe(true)
  }
}

async function expectWorkingChildren(page: Page, rows: Locator, names: string[]): Promise<void> {
  for (const name of names) {
    const child = rowWithLabel(page, rows, name)
    await expect(child).toBeVisible()
    await expect(child.locator('[aria-label="Working"]').first()).toBeVisible()
  }
}

async function expectNativeHookScope(
  runtime: OmpStatusRuntime,
  since = nativeRoot(runtime).at
): Promise<void> {
  const root = nativeRoot(runtime)
  const observations = runtime.observations().filter((row) => row.at >= since)
  const hooks = observations.filter((row) => row.kind === 'hook')
  expect(hooks.every((row) => row.accepted && row.sessionId === root.sessionId)).toBe(true)
  expect(observations.filter((row) => row.kind === 'network-blocked')).toEqual([])
  const nativeIds = new Set(
    observations
      .filter((row) => row.kind === 'lifecycle' && row.status === 'started')
      .map((row) => row.id)
  )
  expect(
    hooks.every((row) =>
      (row.subagents ?? []).every(
        (child) => nativeIds.has(child.id) && !JSON.stringify(child).includes('MODEL_ONLY_')
      )
    )
  ).toBe(true)
  await expect
    .poll(() =>
      runtime
        .observations()
        .some(
          (row) =>
            row.kind === 'hook' &&
            row.accepted &&
            row.at >= since &&
            row.sessionId === root.sessionId &&
            row.hookEvent === 'agent_end' &&
            (row.subagents?.length ?? 0) === 0
        )
    )
    .toBe(true)
}

test('installed OMP keeps named native children fresh through quiet wait, cancellation and completion', async ({
  orcaPage,
  electronApp
}, testInfo) => {
  test.setTimeout(180_000)
  await waitForSessionReady(orcaPage)
  const worktreeId = await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await waitForActiveTerminalManager(orcaPage, 30_000)
  const primaryPane = await waitForActivePaneHookDescriptor(orcaPage)
  await orcaPage.evaluate((worktreeId) => {
    const state = window.__store!.getState()
    state.setAgentActivityDisplayMode('full')
    if (!state.worktreeCardProperties.includes('inline-agents')) {
      state.setWorktreeCardProperties([...state.worktreeCardProperties, 'inline-agents'])
    }
    const tab = state.createTab(worktreeId)
    state.setActiveTab(tab.id)
    state.setActiveTabType('terminal', worktreeId)
  }, worktreeId)
  await waitForActiveTerminalManager(orcaPage, 30_000)
  const isolatedPane = await waitForActivePaneHookDescriptor(orcaPage)
  expect(isolatedPane.paneKey).not.toBe(primaryPane.paneKey)
  expect(
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every((window) => !window.isVisible())
    )
  ).toBe(true)
  const endpoint = await readHookEndpoint(electronApp)
  const names = ['IndexAudit', 'ArtifactCheck', 'QuietWorker']
  const primaryLabel = 'Native OMP primary root'
  const isolatedLabel = 'Native OMP isolated root'
  const runtimes: OmpStatusRuntime[] = []
  try {
    const primary = await startOmpStatusRuntime({
      directory: testInfo.outputPath('primary-native'),
      fixtureSource: deterministicProviderSource,
      rootLabel: primaryLabel,
      names,
      endpoint,
      ...primaryPane
    })
    runtimes.push(primary)
    const isolated = await startOmpStatusRuntime({
      directory: testInfo.outputPath('isolated-native'),
      fixtureSource: deterministicProviderSource,
      rootLabel: isolatedLabel,
      names: ['IsolatedChild'],
      endpoint,
      ...isolatedPane
    })
    runtimes.push(isolated)
    await primary.command('prompt', { message: primaryLabel })
    await isolated.command('prompt', { message: isolatedLabel })
    await expectNativeChildren(primary, names)
    await expectNativeChildren(isolated, ['IsolatedChild'])
    expect(nativeRoot(primary).sessionId).not.toBe(nativeRoot(isolated).sessionId)
    await expect
      .poll(async () => (await readPaneStatus(orcaPage, primaryPane.paneKey))?.toolName)
      .toBe('wait')
    await expect
      .poll(async () => (await readPaneStatus(orcaPage, isolatedPane.paneKey))?.toolName)
      .toBe('wait')

    const rows = worktreeRow(orcaPage, worktreeId).locator(
      '[aria-label="Agents"] .agent-disclosure-row'
    )
    const primaryRow = rowWithLabel(orcaPage, rows, primaryLabel)
    const isolatedRow = rowWithLabel(orcaPage, rows, isolatedLabel)
    await expect(primaryRow).toHaveCount(1)
    await expect(isolatedRow).toHaveCount(1)
    await expandNativeChildren(primaryRow)
    await expandNativeChildren(isolatedRow)
    await expectWorkingChildren(orcaPage, rows, [...names, 'IsolatedChild'])
    await expect(primaryRow).toContainText(/wait/i)
    await capture(orcaPage, testInfo, 'native-named-children')

    const before = await readPaneStatus(orcaPage, primaryPane.paneKey)
    const isolatedBefore = await readPaneStatus(orcaPage, isolatedPane.paneKey)
    if (!before || !isolatedBefore) {
      throw new Error('Native root hook rows were not ingested')
    }
    expect(before.turnStartedAt).toBeGreaterThan(0)
    const quietSince = Date.now()
    await expect
      .poll(
        () =>
          primary
            .observations()
            .some(
              (row) =>
                row.kind === 'hook' &&
                row.accepted &&
                row.hookEvent === 'subagents_update' &&
                row.at >= quietSince + 5_000 &&
                row.subagents?.length === 3
            ),
        { timeout: 20_000, message: 'No authoritative roster refresh during native wait silence' }
      )
      .toBe(true)
    const afterQuiet = await readPaneStatus(orcaPage, primaryPane.paneKey)
    expect(afterQuiet?.updatedAt).toBeGreaterThan(before.updatedAt)
    expect(afterQuiet).toMatchObject({
      state: before.state,
      prompt: before.prompt,
      toolName: 'wait',
      stateStartedAt: before.stateStartedAt,
      turnStartedAt: before.turnStartedAt,
      stateHistory: before.stateHistory,
      lastAssistantMessage: before.lastAssistantMessage
    })
    expect(
      primary
        .observations()
        .filter(
          (row) =>
            row.kind === 'extension' &&
            row.agentKind === 'main' &&
            row.at >= quietSince &&
            ['before_agent_start', 'agent_start', 'tool_execution_end', 'agent_end'].includes(
              row.name ?? ''
            )
        )
    ).toEqual([])
    await expectWorkingChildren(orcaPage, rows, names)
    await capture(orcaPage, testInfo, 'native-quiet-wait-refreshed')

    const cancelledId = primary
      .observations()
      .find(
        (row) =>
          row.kind === 'lifecycle' && row.status === 'started' && row.id?.includes('ArtifactCheck')
      )?.id
    if (!cancelledId) {
      throw new Error('Native scheduler did not name the cancellation target')
    }
    expect(
      (await primary.command('cancel_subagent', { subagentId: cancelledId })).data?.cancelled
    ).toBe(true)
    await expect
      .poll(() =>
        primary
          .observations()
          .some(
            (row) => row.kind === 'lifecycle' && row.id === cancelledId && row.status === 'aborted'
          )
      )
      .toBe(true)
    await expect(rowWithLabel(orcaPage, rows, 'ArtifactCheck')).toHaveCount(0)
    await primary.release('IndexAudit')
    await expect
      .poll(() =>
        primary
          .observations()
          .some(
            (row) =>
              row.kind === 'lifecycle' &&
              row.id?.includes('IndexAudit') &&
              row.status === 'completed'
          )
      )
      .toBe(true)
    await expect(rowWithLabel(orcaPage, rows, 'IndexAudit')).toHaveCount(0)
    await expect(
      rowWithLabel(orcaPage, rows, 'QuietWorker').locator('[aria-label="Working"]').first()
    ).toBeVisible()
    await expect(
      rowWithLabel(orcaPage, rows, 'IsolatedChild').locator('[aria-label="Working"]').first()
    ).toBeVisible()
    await capture(orcaPage, testInfo, 'native-after-cancellation-and-completion')

    await primary.release('root-finish')
    await primary.release('QuietWorker')
    for (const name of names) {
      await expect(rowWithLabel(orcaPage, rows, name)).toHaveCount(0)
    }
    await expect(primaryRow.locator('[aria-label="Done"]').first()).toBeVisible()
    await expect(
      rowWithLabel(orcaPage, rows, 'IsolatedChild').locator('[aria-label="Working"]').first()
    ).toBeVisible()
    const isolatedAfter = await readPaneStatus(orcaPage, isolatedPane.paneKey)
    expect(isolatedAfter).toMatchObject({
      prompt: isolatedBefore.prompt,
      toolName: 'wait',
      stateStartedAt: isolatedBefore.stateStartedAt,
      turnStartedAt: isolatedBefore.turnStartedAt
    })
    await capture(orcaPage, testInfo, 'native-primary-cleared-isolated-root-still-working')

    await isolated.release('root-finish')
    await isolated.release('IsolatedChild')
    await expect(rowWithLabel(orcaPage, rows, 'IsolatedChild')).toHaveCount(0)
    await expect(isolatedRow.locator('[aria-label="Done"]').first()).toBeVisible()
    await expect(rows.locator('[aria-label="Working"]')).toHaveCount(0)
    for (const runtime of runtimes) {
      await expectNativeHookScope(runtime)
    }
    expect(
      primary.observations().filter((row) => row.kind === 'lifecycle' && row.status === 'completed')
    ).toHaveLength(2)
    expect(
      primary.observations().filter((row) => row.kind === 'lifecycle' && row.status === 'aborted')
    ).toHaveLength(1)
    await capture(orcaPage, testInfo, 'native-original-child-rows-cleared')

    const initialPrimaryRoot = nativeRoot(primary)
    await expect.poll(async () => (await primary.command('get_state')).data?.isSettled).toBe(true)
    const initialState = (await primary.command('get_state')).data
    await primary.resetGates()
    expect((await primary.command('new_session')).data?.cancelled).toBe(false)
    const lazyNewState = (await primary.command('get_state')).data
    const reboundRoot = nativeRoot(primary)
    expect(reboundRoot).toMatchObject({
      name: 'session_switch',
      ownerMatches: true,
      managerId: initialPrimaryRoot.managerId,
      sessionId: lazyNewState?.sessionId
    })
    expect(reboundRoot.sessionId).not.toBe(initialPrimaryRoot.sessionId)
    expect(reboundRoot.managerId).toBeGreaterThan(0)

    const reboundLabel = 'Native OMP rebound root'
    const reboundPromptAt = Date.now()
    await primary.command('prompt', { message: reboundLabel })
    await expect
      .poll(() =>
        primary
          .observations()
          .some((row) => row.kind === 'root-model-held' && row.at >= reboundRoot.at)
      )
      .toBe(true)
    const reboundState = (await primary.command('get_state')).data
    if (!reboundState?.sessionFile) {
      throw new Error('New native prompt did not establish a session file')
    }
    expect(reboundState.sessionId).toBe(reboundRoot.sessionId)
    expect(reboundState.sessionFile).not.toBe(initialState?.sessionFile)
    let reboundSnapshot: NativeObservation | undefined
    await expect
      .poll(
        () => {
          reboundSnapshot = primary
            .observations()
            .find(
              (row) =>
                row.kind === 'hook' &&
                row.accepted &&
                row.at >= reboundPromptAt &&
                row.sessionId === reboundRoot.sessionId &&
                row.sessionFile === reboundState.sessionFile &&
                row.hookEvent === 'subagents_update' &&
                row.rootState === 'working' &&
                row.rootPrompt === reboundLabel
            )
          return reboundSnapshot
        },
        {
          timeout: 20_000,
          message: 'No authoritative native snapshot after the same-manager session switch'
        }
      )
      .toBeDefined()
    if (!reboundSnapshot) {
      throw new Error('Missing accepted rebound snapshot')
    }
    const preflightSnapshots = primary
      .observations()
      .filter(
        (row) =>
          row.kind === 'hook' &&
          row.accepted &&
          row.at >= reboundPromptAt &&
          row.sessionId === reboundRoot.sessionId &&
          row.hookEvent === 'subagents_update' &&
          row.rootState === 'working'
      )
    expect(
      preflightSnapshots.every(
        (row) => !row.rootToolName && !row.rootText && (row.subagents?.length ?? 0) === 0
      )
    ).toBe(true)
    const reboundRow = rowWithLabel(orcaPage, rows, reboundLabel)
    await expect(reboundRow.locator('[aria-label="Working"]').first()).toBeVisible()
    await expect(reboundRow).not.toContainText(/wait/i)
    await expect(primaryRow).toHaveCount(0)
    for (const name of [...names, 'IsolatedChild']) {
      await expect(rowWithLabel(orcaPage, rows, name)).toHaveCount(0)
    }
    const reboundPreflight = await readPaneStatus(orcaPage, primaryPane.paneKey)
    const preflightHooks = primary
      .observations()
      .filter(
        (row) =>
          row.kind === 'hook' &&
          row.accepted &&
          row.at >= reboundRoot.at &&
          row.sessionId === reboundRoot.sessionId &&
          row.sessionFile === reboundState.sessionFile
      )
    await writeFile(
      testInfo.outputPath('native-rebound-preflight.json'),
      JSON.stringify(
        {
          reboundRoot,
          reboundSnapshot,
          scopedHooks: preflightHooks,
          status: reboundPreflight
        },
        null,
        2
      )
    )
    if (!reboundPreflight) {
      throw new Error('Missing fresh renderer root after authoritative session replacement')
    }
    expect(reboundPreflight).toMatchObject({
      state: 'working',
      prompt: reboundLabel,
      toolName: undefined,
      lastAssistantMessage: undefined,
      subagents: []
    })
    expect(reboundPreflight.stateStartedAt).toBeGreaterThanOrEqual(reboundRoot.at)
    expect(reboundPreflight.stateStartedAt).toBeGreaterThan(before.stateStartedAt)
    expectReboundTurnClock(reboundPreflight, preflightHooks, reboundRoot, before.turnStartedAt)
    await capture(orcaPage, testInfo, 'native-rebound-root-without-stale-children-or-tool')

    await primary.release('root-start')
    await expectNativeChildren(primary, names)
    await expect
      .poll(async () => (await readPaneStatus(orcaPage, primaryPane.paneKey))?.toolName)
      .toBe('wait')
    await expandNativeChildren(reboundRow)
    await expectWorkingChildren(orcaPage, rows, names)
    const reboundStatus = await readPaneStatus(orcaPage, primaryPane.paneKey)
    const reboundNativeIds = primary
      .observations()
      .filter(
        (row) => row.kind === 'lifecycle' && row.at >= reboundRoot.at && row.status === 'started'
      )
      .map((row) => row.id)
      .sort()
    expect(reboundStatus?.subagents.map((child) => child.id).sort()).toEqual(reboundNativeIds)
    const reboundHooks = primary
      .observations()
      .filter(
        (row) =>
          row.kind === 'hook' &&
          row.accepted &&
          row.at >= reboundRoot.at &&
          row.sessionId === reboundRoot.sessionId &&
          row.sessionFile === reboundState.sessionFile
      )
    const reboundRefs =
      primary
        .observations()
        .findLast((row) => row.kind === 'registry' && row.sessionId === reboundRoot.sessionId)
        ?.refs ?? []
    await writeFile(
      testInfo.outputPath('native-rebound-clock-evidence.json'),
      JSON.stringify(
        {
          initialClock: before.turnStartedAt,
          reboundRoot,
          reboundSnapshot,
          reboundPreflight,
          scopedHooks: reboundHooks,
          nativeRefs: reboundRefs,
          status: reboundStatus
        },
        null,
        2
      )
    )
    if (!reboundStatus) {
      throw new Error('Missing renderer root while rebound native children run')
    }
    expect(reboundStatus).toMatchObject({
      state: 'working',
      prompt: reboundLabel,
      toolName: 'wait',
      lastAssistantMessage: undefined,
      stateStartedAt: reboundPreflight.stateStartedAt
    })
    for (const child of reboundStatus.subagents) {
      const native = reboundRefs.find((ref) => ref.id === child.id)
      expect(child.startedAt).toBe(native?.createdAt)
      expect(child.startedAt).toBeGreaterThanOrEqual(reboundRoot.at)
      expect(child.startedAt).toBeGreaterThan(
        Math.max(...before.subagents.map((previous) => previous.startedAt))
      )
    }
    expectReboundTurnClock(reboundStatus, reboundHooks, reboundRoot, before.turnStartedAt)
    await capture(orcaPage, testInfo, 'native-rebound-named-children')

    await primary.release('root-finish')
    await Promise.all(names.map((name) => primary.release(name)))
    for (const name of names) {
      await expect(rowWithLabel(orcaPage, rows, name)).toHaveCount(0)
    }
    await expect(reboundRow.locator('[aria-label="Done"]').first()).toBeVisible()
    await expect(rows.locator('[aria-label="Working"]')).toHaveCount(0)
    await expectNativeHookScope(primary, reboundSnapshot.at)
    expect(
      primary
        .observations()
        .filter(
          (row) =>
            row.kind === 'lifecycle' && row.at >= reboundRoot.at && row.status === 'completed'
        )
    ).toHaveLength(names.length)
    await writeFile(
      testInfo.outputPath('native-summary.json'),
      JSON.stringify(
        {
          primaryRoot: initialPrimaryRoot,
          isolatedRoot: nativeRoot(isolated),
          reboundRoot,
          before,
          afterQuiet,
          isolatedBefore,
          isolatedAfter,
          initialState,
          lazyNewState,
          reboundState,
          reboundSnapshot,
          reboundStatus,
          reboundPreflight,
          evidence: runtimes.map((runtime) => runtime.directory)
        },
        null,
        2
      )
    )
    await capture(orcaPage, testInfo, 'native-final-child-rows-cleared')
  } finally {
    await Promise.all(runtimes.map((runtime) => runtime.stop()))
  }
})
