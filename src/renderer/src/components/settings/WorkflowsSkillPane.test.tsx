// @vitest-environment happy-dom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getWorkflowsUsageExamples } from '@/lib/workflows-usage-examples'
import { useAppStore } from '../../store'
import { WorkflowsSkillPane } from './WorkflowsSkillPane'
import { getWorkflowsSkillPaneSearchEntries } from './workflows-skill-search'
import { matchesSettingsSearch } from './settings-search'
import { SKILLS_CLI_VERSION } from '../../../../shared/agent-feature-install-commands'

const INSTALL_COMMAND = `npx skills@${SKILLS_CLI_VERSION} add https://github.com/stablyai/orca/tree/${ORCA_BUILD_COMMIT} --skill workflows --global`
const WINDOWS_INSTALL_COMMAND = `cmd.exe /d /s /c "where.exe npx >nul 2>nul & if errorlevel 1 (echo ERROR: npx was not found. Install Node.js LTS from https://nodejs.org/ to get npx. & echo Then close this terminal and start skill setup again - a new terminal picks up the updated PATH. & exit /b 1) else (npx skills@${SKILLS_CLI_VERSION} add https://github.com/stablyai/orca/tree/${ORCA_BUILD_COMMIT} --skill workflows --global)"`

type PanelProps = Record<string, unknown>

const mocks = vi.hoisted(() => ({
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: vi.hoisted loses contextual typing; these arrays only collect test-double props for this suite.
  coverageProps: [] as PanelProps[],
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: vi.hoisted loses contextual typing; these arrays only collect test-double props for this suite.
  dialogProps: [] as PanelProps[],
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: vi.hoisted loses contextual typing; these arrays only collect test-double props for this suite.
  panelProps: [] as PanelProps[],
  skillInstalled: true
}))

vi.mock('./AgentSkillSetupPanel', () => ({
  AgentSkillSetupPanel: (
    props: Record<string, unknown> & { actionHint?: ReactNode; footer?: ReactNode }
  ) => {
    mocks.panelProps.push(props)
    return (
      <section>
        <h3>{String(props.title)}</h3>
        <span>{props.installed ? 'Installed' : 'Not installed'}</span>
        <code>{String(props.command)}</code>
        {props.actionHint}
        {props.footer}
      </section>
    )
  }
}))

vi.mock('./OrchestrationSkillPromptDialog', () => ({
  OrchestrationSkillPromptDialog: (props: Record<string, unknown>) => {
    mocks.dialogProps.push(props)
    return props.open ? (
      <div data-testid="workflows-skill-prompt-dialog">
        <code>{String(props.command)}</code>
      </div>
    ) : null
  }
}))

vi.mock('./OrchestrationSkillAgentCoverage', () => ({
  OrchestrationSkillAgentCoverage: (props: Record<string, unknown>) => {
    mocks.coverageProps.push(props)
    return (
      <footer>
        <h4>Agent coverage</h4>
        <span>{String(props.skillName)}</span>
      </footer>
    )
  }
}))

vi.mock('@/hooks/useInstalledAgentSkills', () => ({
  GLOBAL_AGENT_SKILL_SOURCE_KINDS: ['home'],
  useInstalledAgentSkill: (_skillName: string) => ({
    installed: mocks.skillInstalled,
    loading: false,
    error: null,
    skills: [],
    sources: [],
    refresh: vi.fn().mockResolvedValue(true)
  })
}))

vi.mock('@/hooks/useDetectedAgents', () => ({
  useDetectedAgents: () => ({
    detectedIds: ['claude', 'codex'],
    isLoading: false,
    isRefreshing: false,
    refresh: vi.fn()
  })
}))

let root: Root | null = null
let container: HTMLDivElement | null = null

globalThis.IS_REACT_ACT_ENVIRONMENT = true

async function renderPane(): Promise<HTMLDivElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<WorkflowsSkillPane />)
  })
  return container
}

describe('WorkflowsSkillPane', () => {
  beforeEach(() => {
    useAppStore.setState({ settingsSearchQuery: '' })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        ...window.api,
        platform: {
          get: () => ({ platform: 'win32', osRelease: 'test' })
        },
        wsl: {
          isAvailable: vi.fn().mockResolvedValue(false),
          listDistros: vi.fn().mockResolvedValue([])
        },
        pwsh: {
          isAvailable: vi.fn().mockResolvedValue(false)
        },
        gitBash: {
          isAvailable: vi.fn().mockResolvedValue(false)
        },
        runtime: {
          getStatus: vi.fn().mockResolvedValue({ hostPlatform: 'win32' })
        }
      }
    })
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
      })
    }
    root = null
    container?.remove()
    container = null
    mocks.coverageProps.length = 0
    mocks.dialogProps.length = 0
    mocks.panelProps.length = 0
    mocks.skillInstalled = true
  })

  it('keeps skill setup visible after install and scans the workflows skill', () => {
    const markup = renderToStaticMarkup(<WorkflowsSkillPane />)

    expect(markup).toContain('Workflows skill')
    expect(markup).toContain('Installed')
    expect(mocks.coverageProps.at(-1)).toEqual(
      expect.objectContaining({ skillName: 'workflows', embedded: true })
    )
    expect(markup).not.toContain('Prefer your own terminal?')
    expect(markup).toContain('How to use it')
    const examples = getWorkflowsUsageExamples()
    expect(examples).toHaveLength(4)
    for (const example of examples) {
      expect(markup).toContain(example.title)
    }
  })

  it('matches settings and Cmd+J search for workflow keywords', () => {
    const entries = getWorkflowsSkillPaneSearchEntries()

    for (const query of [
      'workflows',
      'workflow',
      'agent workflow',
      'orca workflows',
      'chain steps'
    ]) {
      expect(matchesSettingsSearch(query, entries)).toBe(true)
    }
    expect(matchesSettingsSearch('screen reader', entries)).toBe(false)
  })

  it('passes the workflows install command, which also updates', () => {
    const markup = renderToStaticMarkup(<WorkflowsSkillPane />)
    const panelProps = mocks.panelProps.at(-1)

    expect(panelProps?.command).toBe(WINDOWS_INSTALL_COMMAND)
    expect(panelProps?.installedCommand).toBeUndefined()
    expect(markup).toContain('--skill workflows')
  })

  it('keeps first-time manual copy on the workflows install command', async () => {
    mocks.skillInstalled = false
    const rendered = await renderPane()

    expect(rendered.textContent).toContain('Prefer your own terminal?')
    expect(rendered.textContent).toContain('Copy install command')

    const copyButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent === 'Copy install command'
    )
    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(mocks.dialogProps.at(-1)).toEqual(
      expect.objectContaining({
        command: WINDOWS_INSTALL_COMMAND,
        open: true,
        title: 'Install workflows skill',
        description:
          'Run this command in a terminal to install the workflows skill for your agents.'
      })
    )
    expect(rendered.textContent).toContain(INSTALL_COMMAND)
  })
})
