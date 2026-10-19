// @vitest-environment happy-dom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import type { ActivePluginTaskSource } from '@/store/plugin-task-sources'
import { i18n } from '../../i18n/i18n'

const mocks = vi.hoisted(() => {
  const state: Record<string, unknown> = {}
  const sources: ActivePluginTaskSource[] = []
  return { state, sources, openTaskPage: vi.fn() }
})

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.state)
}))

vi.mock('@/store/selectors', () => ({
  useRepoMap: () => new Map()
}))

vi.mock('@/store/plugin-task-sources', () => ({
  usePluginTaskSources: () => ({ sources: mocks.sources, ready: true })
}))

vi.mock('@/components/ui/context-menu', () => ({
  ContextMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ContextMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  ContextMenuContent: () => null,
  ContextMenuItem: () => null
}))

import { SidebarTaskNavButton } from './SidebarTaskNavButton'

const AGENT_WORK: ActivePluginTaskSource = {
  pluginKey: 'dev:agent-work',
  sourceId: 'board',
  key: 'dev:agent-work/board',
  pluginName: 'Agent Work',
  title: 'Agent Work',
  icon: 'bot'
}

const mountedRoots: Root[] = []

async function renderTaskNavButton(): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mountedRoots.push(root)
  await act(async () => {
    root.render(<SidebarTaskNavButton />)
  })
  return container
}

function queryShortcut(container: ParentNode, label: string): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
}

describe('SidebarTaskNavButton plugin task source shortcuts', () => {
  afterEach(async () => {
    await act(async () => {
      for (const root of mountedRoots.splice(0)) {
        root.unmount()
      }
    })
    document.body.innerHTML = ''
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    await i18n.changeLanguage('en')
    mocks.sources = []
    mocks.state = {
      settings: getDefaultSettings('/tmp'),
      repos: [],
      activeView: 'worktrees',
      openTaskPage: mocks.openTaskPage,
      updateSettings: vi.fn(),
      preflightStatus: { glab: { installed: false } },
      preflightStatusChecked: true,
      preflightStatusContextKey: null,
      refreshPreflightStatus: vi.fn(),
      linearStatus: { connected: false },
      linearStatusChecked: true,
      checkLinearConnection: vi.fn(),
      prefetchWorkItems: vi.fn(),
      activeRepoId: null
    }
  })

  it('adds a shortcut beside the built-in ones that opens Tasks on that plugin list', async () => {
    mocks.sources = [AGENT_WORK]
    const container = await renderTaskNavButton()

    const github = queryShortcut(container, 'Open GitHub tasks')
    const agentWork = queryShortcut(container, 'Open Agent Work')
    expect(agentWork).not.toBeNull()
    expect(agentWork?.parentElement).toBe(github?.parentElement)

    await act(async () => {
      agentWork?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(mocks.openTaskPage).toHaveBeenCalledWith({
      pluginTaskSource: { pluginKey: 'dev:agent-work', sourceId: 'board' }
    })
  })

  it('adds one shortcut per plugin list', async () => {
    mocks.sources = [
      AGENT_WORK,
      { ...AGENT_WORK, sourceId: 'roadmap', key: 'dev:agent-work/roadmap', title: 'Roadmap' }
    ]
    const container = await renderTaskNavButton()

    expect(queryShortcut(container, 'Open Agent Work')).not.toBeNull()
    expect(queryShortcut(container, 'Open Roadmap')).not.toBeNull()
  })

  it('adds none when no plugin contributes a list', async () => {
    const container = await renderTaskNavButton()

    const labels = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Open "]'),
      (button) => button.getAttribute('aria-label')
    )
    expect(labels).toContain('Open GitHub tasks')
    expect(labels.every((label) => label?.endsWith(' tasks'))).toBe(true)
  })
})
