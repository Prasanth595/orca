// Only model output is deterministic: task/wait/bash, refs, cancellation and hooks use the installed SDK.
export const deterministicProviderSource = String.raw`
import { appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createAssistantMessageEventStream } from '@oh-my-pi/pi-ai';
const names = JSON.parse(process.env.ORCA_OMP_SMOKE_NAMES);
const asyncNames = JSON.parse(process.env.ORCA_OMP_SMOKE_ASYNC_NAMES ?? '[]');
const rootLabel = process.env.ORCA_OMP_SMOKE_ROOT_LABEL;
const gates = process.env.ORCA_OMP_SMOKE_GATES;
const observationPath = process.env.ORCA_OMP_SMOKE_OBSERVATIONS;
const measured = process.env.ORCA_OMP_SMOKE_MEASUREMENTS === '1';
let callSerial = 0;
const managers = new WeakMap();
const startedRefs = new WeakSet();
let managerSerial = 0;
let activeRootLabel = rootLabel;
let snapshotRootRegistry;
let metricTimer;
let nativeList;
let nativeGet;
let lastHookScope;
let lastHookRoster;
const metrics = { listCalls: 0, listMs: 0, getCalls: 0, getMs: 0, registryChanges: 0,
  posts: 0, bytes: 0, acceptedPosts: 0 };
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
  const body = String(options.body);
  const payload = JSON.parse(body).payload;
  const requestAt = Date.now();
  const bytes = Buffer.byteLength(body);
  metrics.posts++; metrics.bytes += bytes;
  const response = await nativeFetch(input, options);
  if (response.status === 204) metrics.acceptedPosts++;
  const scope = payload.session_id + ':' + payload.session_file;
  const roster = (payload.subagents ?? []).map(child => child.id + ':' + child.state + ':' + child.startedAt).join('|');
  const changed = scope !== lastHookScope || roster !== lastHookRoster;
  lastHookScope = scope; lastHookRoster = roster;
  // Scale logs keep scalar admission/freshness samples and only changed rosters, not every full payload.
  record('hook', { accepted: response.status === 204, hookEvent: payload.hook_event_name,
    requestAt, bytes, durationMs: Date.now() - requestAt, httpStatus: response.status,
    sessionId: payload.session_id, sessionFile: payload.session_file,
    subagentCount: payload.subagents?.length ?? 0,
    ...(!measured || changed ? { subagents: payload.subagents } : {}),
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
    else if (Date.now() - started > 180000) {
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
  if (!nativeList) {
    nativeList = registry.list.bind(registry); nativeGet = registry.get.bind(registry);
    if (measured) for (const key of ['list', 'get']) {
      const original = registry[key].bind(registry);
      registry[key] = (...args) => {
        const started = performance.now();
        try { return original(...args); }
        finally { metrics[key + 'Calls']++; metrics[key + 'Ms'] += performance.now() - started; }
      };
    }
  }
  let ownerKind;
  let ownerSessionId;
  let unsubscribe;
  let snapshotTimer;
  for (const name of ['session_start', 'session_switch']) api.on(name, (_event, ctx) => {
    ownerKind = ctx.agent?.kind;
    const manager = ctx.sessionManager;
    ownerSessionId = manager.getSessionId();
    if (!managers.has(manager)) managers.set(manager, ++managerSerial);
    const ownRef = nativeGet(ctx.agent?.id);
    const ownerMatches = ownRef?.session?.sessionManager === manager;
    record('context', { name, agentKind: ownerKind, id: ctx.agent?.id, managerId: managers.get(manager),
      sessionId: manager.getSessionId(), sessionFile: manager.getSessionFile(), ownerMatches });
    if (ownerKind !== 'main') return;
    if (measured) {
      clearInterval(metricTimer);
      const sample = () => {
        const cpu = process.cpuUsage();
        record('native-metrics', { pid: process.pid, cpuUserMicros: cpu.user, cpuSystemMicros: cpu.system,
          rssBytes: process.memoryUsage.rss(), ...metrics });
      };
      sample(); metricTimer = setInterval(sample, 1000); metricTimer.unref();
    }
    let previousSnapshot;
    const terminalRefs = new WeakSet();
    const snapshot = () => {
      snapshotTimer = undefined;
      const refs = nativeList().map(ref => ({ id: ref.id, kind: ref.kind, parentId: ref.parentId,
        status: ref.status, createdAt: ref.createdAt, sessionId: ref.session?.sessionManager?.getSessionId?.(),
        isStreaming: ref.session?.isStreaming,
        pendingAsync: ref.session?.hasPendingAsyncWork?.(),
        acceptedAt: ref.lifecycle?.acceptedAt, terminalAt: ref.lifecycle?.terminalAt,
        sessionFile: ref.sessionFile, rootManager: ref.session?.sessionManager === manager }));
      const signature = JSON.stringify(refs);
      if (signature === previousSnapshot) return;
      previousSnapshot = signature;
      record('registry', { sessionId: manager.getSessionId(),
        ownerMatches: nativeGet(ctx.agent.id)?.session?.sessionManager === manager, refs });
    };
    unsubscribe?.(); clearTimeout(snapshotTimer);
    snapshotRootRegistry = () => { if (!snapshotTimer) snapshotTimer = setTimeout(snapshot, 25); };
    // Native token events do not warrant registry walks or full-registry observation writes.
    unsubscribe = registry.onChange(event => {
      const at = Date.now();
      const ref = event?.ref;
      if (ref?.kind === 'sub' && ref.parentId === ctx.agent.id &&
          ['status_changed', 'metadata_changed'].includes(event.type)) {
        const isStreaming = ref.session?.isStreaming === true;
        const pendingAsync = ref.session?.hasPendingAsyncWork?.() === true;
        if (ref.status === 'running' || pendingAsync) terminalRefs.delete(ref);
        // Idle + pending async work is a scheduling pause, even when the SDK stamps terminalAt.
        if ((ref.status === 'aborted' || (startedRefs.has(ref) && ref.status === 'idle' && !isStreaming && !pendingAsync)) &&
            !terminalRefs.has(ref)) {
          terminalRefs.add(ref);
          record('native-terminal', { at, id: ref.id, status: ref.status, eventType: event.type,
            sessionId: manager.getSessionId(), childSessionId: ref.session?.sessionManager?.getSessionId?.(),
            createdAt: ref.createdAt, isStreaming, pendingAsync,
            nativeTerminalAt: ref.lifecycle?.terminalAt, acceptedAt: ref.lifecycle?.acceptedAt });
        }
      }
      metrics.registryChanges++;
      if (['registered', 'status_changed', 'metadata_changed', 'removed'].includes(event?.type)) snapshotRootRegistry();
    });
    snapshot();
  });
  api.on('session_shutdown', () => {
    unsubscribe?.(); clearTimeout(snapshotTimer);
    if (ownerKind === 'main') clearInterval(metricTimer);
  });
  for (const name of ['before_agent_start', 'agent_start', 'tool_execution_start', 'tool_execution_end', 'agent_end']) {
    api.on(name, (event, ctx) => {
      if (ctx.agent?.kind === 'main' && name === 'before_agent_start' &&
          typeof event.prompt === 'string' && event.prompt.startsWith('Native OMP ')) activeRootLabel = event.prompt;
      record('extension', { name, toolName: event.toolName, willContinue: event.willContinue,
        asyncJobId: event.result?.details?.async?.jobId, asyncState: event.result?.details?.async?.state,
        agentKind: ctx.agent?.kind, sessionId: ctx.sessionManager.getSessionId() });
      // Native attachSession is silent; inspect the real registry after native sessions start.
      if (name === 'agent_start') {
        const ref = nativeGet(ctx.agent?.id);
        if (ref?.kind === 'sub' && ref.session?.sessionManager === ctx.sessionManager) startedRefs.add(ref);
        snapshotRootRegistry?.();
      }
    });
  }
  api.events.on('task:subagent:lifecycle', event => {
    if (ownerKind === 'main') record('lifecycle', { id: event.id, status: event.status, sessionId: ownerSessionId });
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
        const spawned = context.messages.some(message => message.role === 'assistant' &&
          Array.isArray(message.content) && message.content.some(part => part.type === 'toolCall' && part.name === 'task'));
        const userText = context.messages.filter(message => message.role === 'user')
          .map(message => typeof message.content === 'string' ? message.content : JSON.stringify(message.content)).join('\n');
        const namedTask = names.find(name => userText.includes('OMP_SMOKE_CHILD=' + name));
        const root = model.id === 'deterministic' && !namedTask && (context.tools ?? []).some(tool => tool.name === 'task');
        const childName = model.id === 'deterministic' && !root ? namedTask : undefined;
        const background = childName && asyncNames.includes(childName);
        const backgroundSpawn = background && !context.messages.some(message => message.role === 'assistant' &&
          Array.isArray(message.content) && message.content.some(part => part.type === 'toolCall' && part.name === 'bash'));
        if (model.id === 'label') record('auxiliary-model', { name: namedTask, sessionId: options.sessionId });
        if (measured) record('model-request', { name: model.id, agentKind: root ? 'main' : childName ? 'sub' : 'label',
          sessionId: options.sessionId });
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
        if (!aborted && ((root && (!spawned || !existsSync(path.join(gates, 'root-finish')))) || backgroundSpawn)) {
          const part = { type: 'toolCall', id: 'native-status-' + ++callSerial,
            name: backgroundSpawn ? 'bash' : spawned ? 'wait' : 'task', arguments: backgroundSpawn ? {
              command: 'while [ ! -f ' + JSON.stringify(path.join(gates, childName)) +
                ' ]; do sleep 0.1; done; printf native-background-job-released',
              async: true, timeout: 180
            } : spawned ? {} : {
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
          // Tiny/label calls never wait on child gates, even when their prompt mentions a child.
          emit(model.id === 'label' ? '<title>' + (namedTask ?? activeRootLabel) + '</title>' :
            childName ? 'MODEL_ONLY_CHILD_PREVIEW: ' + childName : activeRootLabel);
          if (background) {
            record(existsSync(path.join(gates, childName)) ? 'async-model-resumed' : 'async-model-settled',
              { name: childName, sessionId: options.sessionId });
          } else if (childName && !root) {
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
