// Only model output is deterministic; the installed SDK owns task/wait/bash and every session.
export const deterministicProviderSource = String.raw`
import { existsSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createAssistantMessageEventStream } from '@oh-my-pi/pi-ai';
const names = JSON.parse(process.env.ORCA_OMP_SMOKE_NAMES);
const asyncNames = JSON.parse(process.env.ORCA_OMP_SMOKE_ASYNC_NAMES);
const gates = process.env.ORCA_OMP_SMOKE_GATES;
const observationPath = process.env.ORCA_OMP_SMOKE_OBSERVATIONS;
const observations = [];
const managers = new WeakMap();
let managerSerial = 0;
let callSerial = 0;
let rootLabel = process.env.ORCA_OMP_SMOKE_ROOT_LABEL;
let snapshotRoot;
function record(kind, fields = {}) {
  if (kind === 'registry') {
    const previous = observations.findIndex(row => row.kind === kind && row.sessionId === fields.sessionId);
    if (previous >= 0) observations.splice(previous, 1);
  }
  observations.push({ at: Date.now(), kind, ...fields });
  if (observations.length > 256) observations.shift();
  writeFileSync(observationPath + '.tmp', JSON.stringify(observations));
  renameSync(observationPath + '.tmp', observationPath);
}
const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname !== '127.0.0.1' || url.port !== process.env.ORCA_AGENT_HOOK_PORT || url.pathname !== '/hook/omp') {
    record('network-blocked', { name: url.origin });
    throw new Error('Native OMP test forbids external network');
  }
  const payload = JSON.parse(String(options.body)).payload;
  const response = await nativeFetch(input, options);
  record('hook', { accepted: response.status === 204, hookEvent: payload.hook_event_name,
    sessionId: payload.session_id, sessionFile: payload.session_file,
    rootState: payload.omp_status?.state, subagentIds: (payload.subagents ?? []).map(child => child.id) });
  return response;
};
function waitForRelease(name, signal) {
  const { promise, resolve, reject } = Promise.withResolvers();
  const started = Date.now();
  const finish = aborted => { clearInterval(timer); signal?.removeEventListener('abort', abort); resolve(aborted); };
  const abort = () => finish(true);
  const timer = setInterval(() => {
    if (existsSync(path.join(gates, name))) finish(false);
    else if (Date.now() - started > 300000) {
      clearInterval(timer); signal?.removeEventListener('abort', abort);
      reject(new Error('Deterministic model was never released: ' + name));
    }
  }, 100);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  return promise;
}
export default function(api) {
  const registry = api.pi?.AgentRegistry?.global?.();
  if (!registry || !['list', 'get', 'onChange'].every(key => typeof registry[key] === 'function')) {
    throw new Error('Installed OMP must export its native AgentRegistry');
  }
  let ownerKind;
  let ownerSessionId;
  let unsubscribe;
  let snapshotTimer;
  for (const name of ['session_start', 'session_switch']) api.on(name, (_event, ctx) => {
    const manager = ctx.sessionManager;
    ownerKind = ctx.agent?.kind;
    ownerSessionId = manager.getSessionId();
    if (!managers.has(manager)) managers.set(manager, ++managerSerial);
    record('context', { name, agentKind: ownerKind, id: ctx.agent?.id, managerId: managers.get(manager),
      sessionId: ownerSessionId, sessionFile: manager.getSessionFile(),
      ownerMatches: registry.get(ctx.agent?.id)?.session?.sessionManager === manager });
    if (ownerKind !== 'main') return;
    const snapshot = () => {
      snapshotTimer = undefined;
      record('registry', { sessionId: manager.getSessionId(),
        ownerMatches: registry.get(ctx.agent.id)?.session?.sessionManager === manager,
        refs: registry.list().map(ref => ({ id: ref.id, kind: ref.kind, parentId: ref.parentId,
          status: ref.status, createdAt: ref.createdAt, sessionFile: ref.sessionFile,
          sessionId: ref.session?.sessionManager?.getSessionId?.(),
          isStreaming: ref.session?.isStreaming, pendingAsync: ref.session?.hasPendingAsyncWork?.(),
          terminalAt: ref.lifecycle?.terminalAt, rootManager: ref.session?.sessionManager === manager })) });
    };
    unsubscribe?.(); clearTimeout(snapshotTimer);
    snapshotRoot = () => { if (!snapshotTimer) snapshotTimer = setTimeout(snapshot, 25); };
    unsubscribe = registry.onChange(event => {
      if (['registered', 'status_changed', 'metadata_changed', 'removed'].includes(event?.type)) snapshotRoot();
    });
    snapshot();
  });
  api.on('session_shutdown', () => { unsubscribe?.(); clearTimeout(snapshotTimer); });
  for (const name of ['before_agent_start', 'agent_start', 'tool_execution_start', 'tool_execution_end', 'agent_end']) {
    api.on(name, (event, ctx) => {
      if (ctx.agent?.kind === 'main' && name === 'before_agent_start') rootLabel = event.prompt;
      record('extension', { name, toolName: event.toolName, willContinue: event.willContinue,
        asyncJobId: event.result?.details?.async?.jobId, asyncState: event.result?.details?.async?.state,
        agentKind: ctx.agent?.kind, sessionId: ctx.sessionManager.getSessionId() });
      if (name === 'agent_start' || name === 'agent_end') snapshotRoot?.();
    });
  }
  api.events.on('task:subagent:lifecycle', event => {
    if (ownerKind === 'main') record('lifecycle', { id: event.id, status: event.status, sessionId: ownerSessionId });
  });
  api.on('before_subagent_spawn', () => ({ model: 'orca-status-smoke/deterministic' }));
  api.registerProvider('orca-status-smoke', {
    api: 'orca-status-smoke-api', apiKey: 'offline-test-not-a-credential', baseUrl: 'http://127.0.0.1/never-used',
    models: ['deterministic', 'label'].map(id => ({ id, name: 'Deterministic native status test', reasoning: false,
      input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 131072, maxTokens: 2048 })),
    streamSimple(model, context, options = {}) {
      const stream = createAssistantMessageEventStream();
      void (async () => {
        const used = name => context.messages.some(message => message.role === 'assistant' &&
          Array.isArray(message.content) && message.content.some(part => part.type === 'toolCall' && part.name === name));
        const userText = context.messages.filter(message => message.role === 'user')
          .map(message => typeof message.content === 'string' ? message.content : JSON.stringify(message.content)).join('\n');
        const childName = names.find(name => userText.includes('OMP_SMOKE_CHILD=' + name));
        const root = model.id === 'deterministic' && !childName && (context.tools ?? []).some(tool => tool.name === 'task');
        const background = model.id === 'deterministic' && childName && asyncNames.includes(childName);
        const backgroundSpawn = background && !used('bash');
        record('model-request', { name: model.id, sessionId: options.sessionId });
        let aborted = false;
        const message = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: 'stop', timestamp: Date.now() };
        stream.push({ type: 'start', partial: message });
        if (root && !used('task') && !existsSync(path.join(gates, 'root-start'))) {
          record('root-model-held');
          aborted = await waitForRelease('root-start', options.signal);
        }
        if (!aborted && ((root && (!used('task') || !existsSync(path.join(gates, 'root-finish')))) || backgroundSpawn)) {
          const part = { type: 'toolCall', id: 'native-status-' + ++callSerial,
            name: backgroundSpawn ? 'bash' : used('task') ? 'wait' : 'task', arguments: backgroundSpawn ? {
              command: 'while [ ! -f ' + JSON.stringify(path.join(gates, childName)) +
                ' ]; do sleep 0.1; done; printf native-background-job-released', async: true, timeout: 300
            } : used('task') ? {} : {
              context: 'Native scheduler test for ' + rootLabel,
              tasks: names.map(name => ({ name, agent: 'status-smoke',
                task: 'OMP_SMOKE_CHILD=' + name + ' MODEL_ONLY_INSTRUCTION: return deterministic text.',
                solutionSpace: 'one fixed response' }))
            } };
          message.content.push(part);
          stream.push({ type: 'toolcall_start', contentIndex: 0, partial: message });
          stream.push({ type: 'toolcall_end', contentIndex: 0, toolCall: part, partial: message });
          message.stopReason = 'toolUse';
        } else {
          const part = { type: 'text', text: model.id === 'label' ? '<title>' + (childName ?? rootLabel) + '</title>' :
            childName ? 'MODEL_ONLY_CHILD_PREVIEW: ' + childName : rootLabel };
          message.content.push(part);
          stream.push({ type: 'text_start', contentIndex: 0, partial: message });
          stream.push({ type: 'text_delta', contentIndex: 0, delta: part.text, partial: message });
          if (background) record(existsSync(path.join(gates, childName)) ? 'async-model-resumed' : 'async-model-settled',
            { name: childName, sessionId: options.sessionId });
          else if (model.id === 'deterministic' && childName) {
            record('model-held', { name: childName, sessionId: options.sessionId });
            aborted = await waitForRelease(childName, options.signal);
          }
          stream.push({ type: 'text_end', contentIndex: 0, content: part.text, partial: message });
        }
        if (aborted) {
          message.stopReason = 'aborted';
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
