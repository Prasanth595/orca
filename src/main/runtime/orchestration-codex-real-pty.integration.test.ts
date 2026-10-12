import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as pty from 'node-pty'
import { expect, it, vi } from 'vitest'
import { AgentHookServer } from '../agent-hooks/server'
import { getManagedScript } from '../codex/codex-hook-script'
import { getManagedCommand } from '../codex/codex-hook-definition'
import { runCodexHookTrustGrantSession } from '../codex/codex-app-server-client'
import { normalizeHookTrustKeyForLookup } from '../codex/config-toml-trust'
import { getExplicitHomeCodexHookSourcePath } from '../codex/codex-trust-identity'
import { readWindowsProcessIdentityTable } from '../windows/windows-process-table'
import { getSyntheticAgentTerminalTitle } from '../../shared/synthetic-agent-title'
import { extractAllOscTitles } from '../../shared/osc-title-extraction'
import { extractOscTitleScanTail } from '../../shared/osc-title-scan-tail'
import { settledWriteStub } from '../providers/settled-pty-write-stub'
import {
  createBoundRun,
  createDatabase,
  createRuntime,
  insertDirectRunMessage,
  LAUNCH_TOKEN,
  PANE_KEY,
  PTY_ID,
  TAB_ID,
  WORKTREE_ID,
  temporaryDirectories
} from './orchestration-mailbox-notification-test-harness'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => tmpdir()), isPackaged: false },
  BrowserWindow: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  webContents: { fromId: vi.fn(() => null) }
}))

const binary = process.env.ORCA_REPRO_CODEX_BINARY
const coordinatedMailbox = process.env.ORCA_REPRO_POINTER_PROTOCOL !== 'legacy'
const trials = (['before', 'after'] as const).flatMap((arrival) =>
  [1, 2, 3].map((trial) => ({ arrival, trial }))
)
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

it.skipIf(!binary).each(trials)(
  'submits mail arriving $arrival a real Codex completion (trial $trial)',
  async ({ arrival }) => {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), 'orca-codex-mailbox-')))
    const workspace = join(directory, 'work')
    mkdirSync(workspace)
    const trace: { ms: number; kind: string; value: unknown }[] = []
    const start = performance.now()
    const record = (kind: string, value: unknown) => {
      trace.push({ ms: Math.round(performance.now() - start), kind, value })
    }
    let raw = ''
    let submittedMail = false
    let requests = 0
    const model = createServer(async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(404).end()
        return
      }
      let body = ''
      for await (const chunk of req) {
        body += chunk
      }
      const notification = body.includes('You have 1 orchestration message')
      if (notification) {
        submittedMail = true
      }
      const id = `response-${++requests}`
      record('model-request', { id, notification })
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      await delay(400)
      const events = [
        { type: 'response.created', response: { id } },
        {
          type: 'response.output_item.done',
          item: {
            type: 'message',
            role: 'assistant',
            id: `msg-${id}`,
            content: [{ type: 'output_text', text: 'Fixture finished.' }]
          }
        },
        {
          type: 'response.completed',
          response: { id, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }
        }
      ]
      for (const event of events) {
        res.write(`data: ${JSON.stringify(event)}\n\n`)
      }
      res.end()
    })
    await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve))
    const address = model.address()
    if (!address || typeof address === 'string') {
      throw new Error('Missing fixture port')
    }
    const hooks = new AgentHookServer()
    await hooks.start()
    const db = createDatabase('orca-codex-mailbox-db-')
    const { runtime } = createRuntime(db, {
      getAgentStatusSnapshot: () => hooks.getStatusSnapshot()
    })
    const run = createBoundRun(
      db,
      'Real Codex completion',
      coordinatedMailbox ? 'coordination' : 'all'
    )
    let queuedMail = false
    let stops = 0
    hooks.setListener((event) => {
      record('hook', { event: event.hookEventName, state: event.payload.state })
      if (event.hookEventName === 'UserPromptSubmit' && !queuedMail && arrival === 'before') {
        queuedMail = true
        insertDirectRunMessage(
          db,
          run.id,
          'Worker progress',
          coordinatedMailbox ? 'question' : 'status'
        )
      }
      if (event.hookEventName === 'Stop') {
        stops++
      }
      const title = getSyntheticAgentTerminalTitle(event.payload.agentType, event.payload.state)
      if (title) {
        record('hook-title', title)
        runtime.ingestSyntheticTitleFrame(PTY_ID, `\x1b]0;${title}\x07`)
      }
    })
    const script = join(directory, process.platform === 'win32' ? 'orca-hook.cmd' : 'orca-hook.sh')
    writeFileSync(script, getManagedScript())
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
    const hookCommand =
      process.platform === 'win32' ? getManagedCommand(script) : `sh ${quote(script)}`
    writeFileSync(
      join(directory, 'hooks.json'),
      JSON.stringify({
        hooks: Object.fromEntries(
          ['SessionStart', 'UserPromptSubmit', 'Stop'].map((event) => [
            event,
            [
              {
                hooks: [
                  {
                    type: 'command',
                    // Hold real hook completion open across native animation ticks; no title bytes are invented.
                    command: hookCommand
                  }
                ]
              }
            ]
          ])
        )
      })
    )
    writeFileSync(
      join(directory, 'config.toml'),
      [
        'model="gpt-6-sol"',
        'model_provider="fixture"',
        'check_for_update_on_startup=false',
        '[model_providers.fixture]',
        'name="fixture"',
        `base_url="http://127.0.0.1:${address.port}/v1"`,
        'wire_api="responses"',
        'requires_openai_auth=false',
        '[tui]',
        'terminal_title=["spinner","project-name"]',
        `[projects.${JSON.stringify(workspace)}]`,
        'trust_level="trusted"'
      ].join('\n')
    )
    const env = Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => {
        const [key, value] = entry
        return value !== undefined && !key.startsWith('ORCA_') && !key.startsWith('CODEX_')
      })
    )
    const trust = await runCodexHookTrustGrantSession({
      invocation: {
        command: binary!,
        args: ['app-server'],
        cliPath: binary!,
        env: { CODEX_HOME: directory, ORCA_BACKGROUND_LAUNCH: '1' },
        timeoutMs: 10_000
      },
      hooksListCwd: workspace,
      expectedTrustKeys: ['session_start', 'user_prompt_submit', 'stop'].map((event) =>
        normalizeHookTrustKeyForLookup(
          `${getExplicitHomeCodexHookSourcePath(join(directory, 'hooks.json'))}:${event}:0:0`
        )
      ),
      managedCommand: hookCommand
    })
    if (trust.outcome !== 'granted') {
      hooks.stop()
      model.closeAllConnections()
      await new Promise<void>((resolve) => model.close(() => resolve()))
      db.close()
      throw new Error(trust.reason)
    }
    const terminal = pty.spawn(binary!, ['--no-alt-screen', 'Reply OK only'], {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd: workspace,
      env: {
        ...env,
        ...hooks.buildPtyEnv(),
        CODEX_HOME: directory,
        TERM: 'xterm-256color',
        ORCA_BACKGROUND_LAUNCH: '1',
        ORCA_PANE_KEY: PANE_KEY,
        ORCA_TAB_ID: TAB_ID,
        ORCA_WORKTREE_ID: WORKTREE_ID,
        ORCA_AGENT_LAUNCH_TOKEN: LAUNCH_TOKEN
      }
    })
    let exited = false
    const exit = new Promise<void>((resolve) =>
      terminal.onExit(() => {
        exited = true
        resolve()
      })
    )
    const writes: string[] = []
    const write = (_id: string, data: string) => {
      record('input', data)
      writes.push(data)
      terminal.write(data)
      return true
    }
    runtime.setPtyController({
      getSize: () => ({ cols: 120, rows: 40 }),
      write,
      writeWithSettlement: settledWriteStub(write),
      kill: () => {
        terminal.kill()
        return true
      },
      getForegroundProcess: async () => {
        const name =
          process.platform === 'win32'
            ? ((await readWindowsProcessIdentityTable()).find((row) => row.pid === terminal.pid)
                ?.name ?? null)
            : terminal.process
        record('foreground', name)
        return name
      }
    })
    let osc = ''
    terminal.onData((data) => {
      raw += data
      if (data.includes('\x1b[6n')) {
        terminal.write('\x1b[1;1R')
      }
      osc += data
      const titles = extractAllOscTitles(osc)
      for (const title of titles) {
        record('native-title', title)
      }
      const nativeIdle = titles.includes('work')
      osc = extractOscTitleScanTail(osc)
      runtime.onPtyData(PTY_ID, data, Date.now())
      if (arrival === 'after' && stops > 0 && !queuedMail && nativeIdle) {
        queuedMail = true
        insertDirectRunMessage(
          db,
          run.id,
          'Later worker progress',
          coordinatedMailbox ? 'question' : 'status'
        )
        runtime.notifyMessageArrived(`run:${run.id}`, coordinatedMailbox ? 'question' : 'status')
        record('later-mail', 'arrived after the native idle title')
      }
    })
    try {
      await runtime.listTerminals()
      const startupDeadline = Date.now() + 60_000
      while (stops === 0 && !exited && Date.now() < startupDeadline) {
        await delay(50)
      }
      record('startup-result', { stops, requests })
      expect(
        stops,
        'Initial Codex turn must finish before observing mailbox delivery'
      ).toBeGreaterThan(0)
      const deadline = Date.now() + 15_000
      while (!submittedMail && !exited && Date.now() < deadline) {
        await delay(50)
      }
      if (coordinatedMailbox && submittedMail) {
        const settlementDeadline = Date.now() + 10_000
        while (
          db.getPendingMailboxPointerMessages(`run:${run.id}`).length &&
          Date.now() < settlementDeadline
        ) {
          await delay(50)
        }
        expect(db.getPendingMailboxPointerMessages(`run:${run.id}`)).toHaveLength(0)
        expect(
          db.getUnreadMessages(`run:${run.id}`).every((row) => row.delivered_at !== null)
        ).toBe(true)
      }
      record('result', { arrival, submittedMail, stops, writes })
      const stopIndex = trace.findIndex(
        (event) => event.kind === 'hook' && (event.value as { event: string }).event === 'Stop'
      )
      expect(stopIndex).toBeGreaterThan(-1)
      const tail = trace.slice(stopIndex + 1).filter((event) => event.kind === 'native-title')
      expect(tail.some((event) => /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] work$/.test(String(event.value)))).toBe(true)
      expect(tail.some((event) => event.value === 'work')).toBe(true)
      expect(writes.filter((data) => data === '\r')).toHaveLength(1)
      expect(submittedMail).toBe(true)
    } finally {
      if (!exited) {
        terminal.kill(process.platform === 'win32' ? undefined : 'SIGKILL')
      }
      await Promise.race([exit, delay(2000)])
      hooks.stop()
      model.closeAllConnections()
      await new Promise<void>((resolve) => model.close(() => resolve()))
      record('artifact', directory)
      writeFileSync(join(directory, 'trace.json'), JSON.stringify(trace, null, 2))
      writeFileSync(join(directory, 'terminal.bin'), raw)
      console.log(`Real Codex evidence: ${directory}`)
      db.close()
      for (const path of temporaryDirectories.splice(0)) {
        rmSync(path, { recursive: true, force: true })
      }
    }
  },
  80_000
)
