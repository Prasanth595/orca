/**
 * Drives one Orca app through reply-reveal scenarios: opens stand-in agent tabs, submits as a person
 * (Playwright keys through xterm) or as Orca (terminal.send, dictation paste), ends turns, and records
 * whether main revealed the agent's tab for each completion.
 */
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { expect } from '@stablyai/playwright-test'
import { RuntimeClient } from '../../../src/cli/runtime-client'
import type { RuntimeTerminalListResult } from '../../../src/shared/runtime-types'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './store'
import {
  focusActiveTerminalInput,
  sendToTerminal,
  waitForActivePaneHookDescriptor,
  waitForActivePanePtyId,
  waitForTerminalOutput
} from './terminal'
import { resolveActiveTabId } from './terminal-pane-identity'
import { waitForPtyShellEcho } from '../terminal-pty-readiness'
import {
  controlFakeReplyAgent,
  countAcceptedFakeReplyHooks,
  readFakeReplyAgentStdin,
  type FakeReplyAgentProvider
} from './reply-reveal-fake-agent'
import {
  activateTab,
  createTerminalTab,
  installReplyRevealProbes,
  readActiveView,
  readReplyRevealProbe
} from './reply-reveal-probes'

// Why: desktop completions share a 5s per-workspace burst cooldown; a second completion inside it
// never reaches the reveal decision, so a "no reveal" there would prove nothing.
const COOLDOWN_GAP_MS = 5_600
// Why: covers the renderer's 1.5s done-quiet window plus the async provenance check.
const SETTLE_MS = 3_500

export type ReplyAgentTab = {
  provider: FakeReplyAgentProvider
  tabId: string
  paneKey: string
  worktreeId: string
  handle: string
}

export type ReplyRevealOutcome = {
  scenario: string
  expected: boolean
  revealed: boolean
  banners: number
}

export class ReplyRevealHarness {
  readonly outcomes: ReplyRevealOutcome[] = []
  private lastCompletionAt = 0

  constructor(
    readonly page: Page,
    readonly app: ElectronApplication,
    private readonly client: RuntimeClient,
    private readonly decoyTabId: string,
    private readonly fakeDir: string,
    private readonly agentScript: string
  ) {}

  async openAgent(provider: FakeReplyAgentProvider): Promise<ReplyAgentTab> {
    const tabId = await createTerminalTab(this.page)
    const { worktreeId } = await readActiveView(this.page)
    const ptyId = await waitForActivePanePtyId(this.page)
    await waitForPtyShellEcho(this.page, ptyId, 30_000)
    const { paneKey } = await waitForActivePaneHookDescriptor(this.page)
    // A program write launches the agent, as Orca's own launch path does.
    await sendToTerminal(
      this.page,
      ptyId,
      `exec node '${this.agentScript}' ${provider} '${this.fakeDir}'\r`
    )
    await waitForTerminalOutput(this.page, `[fake] ${provider} ready`, 20_000)
    if (provider === 'claude') {
      await expect.poll(() => this.hooks(provider, 'SessionStart'), { timeout: 20_000 }).toBe(1)
    }
    let handle: string | undefined
    await expect
      .poll(
        async () => {
          const list = await this.client.call<RuntimeTerminalListResult>('terminal.list')
          handle = list.result.terminals.find((terminal) => terminal.tabId === tabId)?.handle
          return handle ?? null
        },
        { timeout: 20_000 }
      )
      .not.toBeNull()
    return { provider, tabId, paneKey, worktreeId: worktreeId ?? '', handle: handle ?? '' }
  }

  hooks(provider: FakeReplyAgentProvider, name: string): number {
    return countAcceptedFakeReplyHooks(this.fakeDir, provider, name)
  }

  async humanType(agent: ReplyAgentTab, text: string): Promise<void> {
    await activateTab(this.page, agent.tabId)
    await focusActiveTerminalInput(this.page)
    if (text) {
      await this.page.keyboard.type(text)
    }
    await this.page.keyboard.press('Enter')
  }

  async programSend(agent: ReplyAgentTab, text: string): Promise<void> {
    await this.client.call('terminal.send', { terminal: agent.handle, text, enter: true })
  }

  /** Fills the draft through dictation's insert, which Orca writes as a program paste. */
  async dictateDraft(agent: ReplyAgentTab, text: string): Promise<void> {
    await activateTab(this.page, agent.tabId)
    await focusActiveTerminalInput(this.page)
    await this.page.evaluate(
      ({ tabId, text }) => {
        document.dispatchEvent(new CustomEvent('dictation:insertText', { detail: { tabId, text } }))
      },
      { tabId: agent.tabId, text }
    )
    await expect
      .poll(() => this.stdinContains(agent.provider, text), { timeout: 10_000 })
      .toBe(true)
  }

  private stdinContains(provider: FakeReplyAgentProvider, text: string): boolean {
    return readFakeReplyAgentStdin(this.fakeDir, provider).includes(text)
  }

  async waitForSubmissions(agent: ReplyAgentTab, count: number): Promise<void> {
    await expect
      .poll(() => this.hooks(agent.provider, 'UserPromptSubmit'), { timeout: 15_000 })
      .toBe(count)
  }

  /** Compacts the running turn the way Claude's auto-compaction reports it. */
  async compact(agent: ReplyAgentTab): Promise<void> {
    const starts = this.hooks(agent.provider, 'SessionStart')
    controlFakeReplyAgent(this.fakeDir, agent.provider, 'compact')
    await expect
      .poll(() => this.hooks(agent.provider, 'SessionStart'), { timeout: 10_000 })
      .toBe(starts + 1)
  }

  async lookElsewhere(): Promise<void> {
    await activateTab(this.page, this.decoyTabId)
  }

  /** Shows the other seeded workspace, so the agent's workspace is not the active one. */
  async lookAtOtherWorkspace(): Promise<void> {
    await this.page.evaluate(() => {
      const state = window.__store!.getState()
      const active = state.activeWorktreeId
      const other = Object.values(state.worktreesByRepo)
        .flat()
        .find((worktree) => worktree.id !== active)
      if (!other) {
        throw new Error('No second workspace to look at')
      }
      state.setActiveWorktree(other.id)
    })
  }

  /** Ends the agent's turn (or wakes it) and records whether main revealed that agent's tab. */
  async complete(
    scenario: string,
    agent: ReplyAgentTab,
    expected: boolean,
    command: 'finish' | 'wake' = 'finish'
  ): Promise<void> {
    const wait = this.lastCompletionAt + COOLDOWN_GAP_MS - Date.now()
    if (wait > 0) {
      await this.page.waitForTimeout(wait)
    }
    const stops = this.hooks(agent.provider, 'Stop')
    const before = await readReplyRevealProbe(this.app)
    controlFakeReplyAgent(this.fakeDir, agent.provider, command)
    await expect.poll(() => this.hooks(agent.provider, 'Stop'), { timeout: 15_000 }).toBe(stops + 1)
    this.lastCompletionAt = Date.now()
    const revealedTab = (): Promise<boolean> =>
      readReplyRevealProbe(this.app).then((log) =>
        log.reveals
          .slice(before.reveals.length)
          .some(
            (reveal) => reveal.channel === 'ui:focusTerminal' && reveal.paneKey === agent.paneKey
          )
      )
    // An expected reveal returns as soon as it lands; a refused one waits out the async decision.
    await (expected
      ? expect
          .poll(revealedTab, { timeout: 10_000 })
          .toBe(true)
          .catch(() => undefined)
      : this.page.waitForTimeout(SETTLE_MS))
    const after = await readReplyRevealProbe(this.app)
    const revealed = await revealedTab()
    const outcome = {
      scenario,
      expected,
      revealed,
      banners: after.banners.length - before.banners.length
    }
    this.outcomes.push(outcome)
    console.log(`[reply-reveal] ${JSON.stringify(outcome)}`)
    expect.soft(revealed, `${scenario}: reveal`).toBe(expected)
    if (revealed) {
      const view = await readActiveView(this.page)
      expect.soft(view.tabId, `${scenario}: revealed tab`).toBe(agent.tabId)
      expect.soft(view.worktreeId, `${scenario}: revealed workspace`).toBe(agent.worktreeId)
    }
  }
}

export async function setUpReplyRevealHarness(
  page: Page,
  app: ElectronApplication,
  fakeDir: string,
  agentScript: string
): Promise<ReplyRevealHarness> {
  await waitForSessionReady(page)
  await waitForActiveWorktree(page)
  await ensureTerminalVisible(page)
  const decoyTabId = await resolveActiveTabId(page)
  if (!decoyTabId) {
    throw new Error('The seeded worktree has no terminal tab to look at')
  }
  await installReplyRevealProbes(app)
  await page.evaluate(async () => {
    const state = window.__store!.getState()
    await state.updateSettings({
      notifications: {
        ...state.settings!.notifications,
        enabled: true,
        agentTaskComplete: true,
        bringToFrontOnAgentTaskComplete: true
      }
    })
  })
  const userDataDir = await app.evaluate(({ app }) => app.getPath('userData'))
  const client = new RuntimeClient(userDataDir, 30_000, null, null)
  return new ReplyRevealHarness(page, app, client, decoyTabId, fakeDir, agentScript)
}
