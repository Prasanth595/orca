// @vitest-environment happy-dom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import NewWorkspaceComposerCard from './NewWorkspaceComposerCard'
import type { NewWorkspaceProjectOption } from '@/lib/new-workspace-project-options'

vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: unknown) => unknown) =>
      selector({
        closeModal: vi.fn(),
        openModal: vi.fn(),
        openSettingsPage: vi.fn(),
        openSettingsTarget: vi.fn(),
        setRuntimeEnvironmentStatus: vi.fn(),
        activeModal: 'none',
        settings: { defaultTuiAgent: null, disabledTuiAgents: [] },
        updateSettings: vi.fn(),
        projects: [],
        repos: []
      }),
    { getState: () => ({ setRuntimeEnvironmentStatus: vi.fn() }) }
  )
}))

vi.mock('@/components/contextual-tours/use-contextual-tour', () => ({
  useContextualTour: vi.fn()
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

vi.mock('@/components/agent/AgentCombobox', () => ({
  default: () => <button type="button">Agent picker</button>
}))

vi.mock('@/components/sidebar/AddRemoteHostDialog', () => ({
  AddRemoteHostDialog: () => null
}))

vi.mock('@/components/new-workspace/SetProjectLocationDialog', () => ({
  SetProjectLocationDialog: () => null
}))

vi.mock('@/components/sparse/SparseCheckoutPresetSelect', () => ({
  default: ({ onEditingChange }: { onEditingChange?: (editing: boolean) => void }) => (
    <button type="button" onClick={() => onEditingChange?.(true)}>
      Begin preset
    </button>
  )
}))

vi.mock('@/components/new-workspace/SmartWorkspaceNameField', () => ({
  default: () => <input aria-label="workspace name" />
}))

vi.mock('@/components/new-workspace/ProjectCombobox', () => ({
  default: () => <div data-testid="project-combobox" />
}))

const projectOptions: NewWorkspaceProjectOption[] = [
  {
    kind: 'project-group',
    id: 'project-group:platform',
    projectGroupId: 'platform',
    displayName: 'Platform',
    badgeColor: 'var(--muted-foreground)',
    detail: '/workspace/platform',
    parentPath: '/workspace/platform',
    connectionId: null
  }
]

type CardProps = React.ComponentProps<typeof NewWorkspaceComposerCard>

function cardElement(overrides: Partial<CardProps>): React.JSX.Element {
  return (
    <NewWorkspaceComposerCard
      quickAgent={null}
      onQuickAgentChange={() => {}}
      eligibleRepos={[]}
      repoId="repo-a"
      projectOptions={projectOptions}
      selectedProjectId="project-group:platform"
      selectedRepoIsGit
      onRepoChange={() => {}}
      onProjectChange={() => {}}
      primaryActionLabel="Start in workspace"
      name=""
      onNameValueChange={() => {}}
      onSmartGitHubItemSelect={() => {}}
      onSmartGitLabItemSelect={() => {}}
      onSmartBranchSelect={() => {}}
      onSmartLinearIssueSelect={() => {}}
      smartNameSelection={null}
      onClearSmartNameSelection={() => {}}
      canReuseSelectedBranch={false}
      reuseSelectedBranch={false}
      onReuseSelectedBranchChange={() => {}}
      branchNameOverride=""
      onBranchNameOverrideChange={() => {}}
      parentWorktreeId={null}
      onParentWorktreeIdChange={() => {}}
      forkPushWarning={null}
      detectedAgentIds={null}
      onOpenAgentSettings={() => {}}
      advancedOpen
      onToggleAdvanced={() => {}}
      createDisabled={false}
      projectError={null}
      creating={false}
      onCreate={() => {}}
      note=""
      onNoteChange={() => {}}
      setupConfig={null}
      requiresExplicitSetupChoice={false}
      setupDecision={null}
      onSetupDecisionChange={() => {}}
      setupAgentStartupPolicy="start-immediately"
      onSetupAgentStartupPolicyChange={() => {}}
      shouldWaitForSetupCheck={false}
      resolvedSetupDecision={null}
      createError={null}
      selectedRepoConnectionId={null}
      selectedRepoSshStatus={null}
      selectedRepoRequiresConnection={false}
      selectedRepoConnectInProgress={false}
      onConnectSelectedRepo={async () => {}}
      canUseSparseCheckout
      sparsePresets={[]}
      sparseSelectedPresetId={null}
      onSparseSelectPreset={() => {}}
      branchesEnabled={false}
      setupControlsEnabled={false}
      sparseControlsEnabled
      {...overrides}
    />
  )
}

let current: { container: HTMLDivElement; root: Root } | null = null

function renderCard(overrides: Partial<CardProps> = {}): HTMLDivElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(cardElement(overrides)))
  current = { container, root }
  return container
}

function rerenderCard(overrides: Partial<CardProps>): void {
  act(() => current?.root.render(cardElement(overrides)))
}

function buttonWithText(container: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((node) => node.textContent?.includes(text))
}

describe('NewWorkspaceComposerCard starting in an existing workspace', () => {
  afterEach(() => {
    act(() => current?.root.unmount())
    current?.container.remove()
    current = null
  })

  it('leaves out the name, Advanced and Create more, which only shape a new workspace', () => {
    const container = renderCard({ showCreateMultiple: true })
    expect(container.querySelector('[aria-label="workspace name"]')).not.toBeNull()
    expect(buttonWithText(container, 'Advanced')).toBeDefined()
    expect(buttonWithText(container, 'Create more')).toBeDefined()

    rerenderCard({ showCreateMultiple: true, startsInExistingWorkspace: true })

    expect(container.querySelector('[aria-label="workspace name"]')).toBeNull()
    expect(buttonWithText(container, 'Advanced')).toBeUndefined()
    expect(buttonWithText(container, 'Create more')).toBeUndefined()
    expect(container.textContent).toContain('Start in workspace')
  })

  it('keeps the start button when an existing workspace is picked during a preset edit', () => {
    const container = renderCard()
    act(() => buttonWithText(container, 'Begin preset')?.click())
    expect(container.textContent).not.toContain('Start in workspace')

    rerenderCard({ startsInExistingWorkspace: true })

    expect(container.textContent).toContain('Start in workspace')
    expect(container.querySelector('[data-sparse-preset-editing]')).toBeNull()
  })
})
