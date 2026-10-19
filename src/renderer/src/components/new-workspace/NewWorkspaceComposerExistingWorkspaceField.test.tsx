// @vitest-environment happy-dom

import type React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Worktree } from '../../../../shared/worktree/types'

type FakeStoreState = { worktreesByRepo: Record<string, Worktree[]> }

const storeState = vi.hoisted((): FakeStoreState => ({ worktreesByRepo: {} }))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof storeState) => unknown) => selector(storeState)
}))

// Radix Select needs pointer and layout APIs the test DOM lacks; a native select keeps its contract.
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    disabled,
    children
  }: {
    value: string
    onValueChange: (value: string) => void
    disabled?: boolean
    children: React.ReactNode
  }) => (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  )
}))

const { NewWorkspaceComposerExistingWorkspaceField } =
  await import('./NewWorkspaceComposerExistingWorkspaceField')

const REPO_ID = 'repo1'

function makeWorktree(overrides: Partial<Worktree> & { id: string }): Worktree {
  return {
    repoId: REPO_ID,
    path: `/work/${overrides.id}`,
    head: 'abc123',
    branch: 'refs/heads/feature',
    isBare: false,
    isMainWorktree: false,
    displayName: overrides.id,
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    ...overrides
  }
}

function seed(worktrees: Worktree[]): void {
  const byRepo: Record<string, Worktree[]> = {}
  for (const worktree of worktrees) {
    byRepo[worktree.repoId] = [...(byRepo[worktree.repoId] ?? []), worktree]
  }
  storeState.worktreesByRepo = byRepo
}

function renderField(
  props: Partial<React.ComponentProps<typeof NewWorkspaceComposerExistingWorkspaceField>> = {}
): { onChange: ReturnType<typeof vi.fn> } {
  const onChange = vi.fn()
  render(
    <NewWorkspaceComposerExistingWorkspaceField
      repoId={REPO_ID}
      executionHostId="ssh:box"
      value={null}
      onChange={onChange}
      unavailableReason={null}
      {...props}
    />
  )
  return { onChange }
}

function optionLabels(): string[] {
  return screen.getAllByRole('option').map((option) => option.textContent ?? '')
}

beforeEach(() => {
  storeState.worktreesByRepo = {}
})

afterEach(cleanup)

describe('NewWorkspaceComposerExistingWorkspaceField', () => {
  it("offers a new workspace plus the project's live workspaces on its host, by name", () => {
    seed([
      makeWorktree({ id: 'wt-b', displayName: 'beta' }),
      makeWorktree({ id: 'wt-a', displayName: 'alpha', hostId: 'ssh:box' }),
      makeWorktree({ id: 'wt-archived', displayName: 'archived', isArchived: true }),
      makeWorktree({ id: 'wt-other-host', displayName: 'other host', hostId: 'ssh:other' }),
      makeWorktree({ id: 'wt-other-repo', displayName: 'other repo', repoId: 'repo2' })
    ])

    renderField()

    expect(optionLabels()).toEqual(['New workspace', 'alpha', 'beta'])
    expect(screen.getByRole('combobox')).toHaveProperty('value', 'new-workspace')
    expect(screen.getByText('Creates a workspace and starts the agent there.')).toBeTruthy()
  })

  it('reports the picked workspace, and null when New workspace is picked again', () => {
    seed([makeWorktree({ id: 'wt-a', displayName: 'alpha' })])
    const { onChange } = renderField()

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'wt-a' } })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'new-workspace' } })

    expect(onChange.mock.calls).toEqual([['wt-a'], [null]])
  })

  it('shows a selected workspace, and falls back to New workspace once it is gone', () => {
    seed([makeWorktree({ id: 'wt-a', displayName: 'alpha' })])
    renderField({ value: 'wt-a' })

    expect(screen.getByRole('combobox')).toHaveProperty('value', 'wt-a')
    expect(
      screen.getByText('Opens an agent tab in this workspace instead of creating one.')
    ).toBeTruthy()

    cleanup()
    seed([])
    renderField({ value: 'wt-a' })

    expect(screen.getByRole('combobox')).toHaveProperty('value', 'new-workspace')
  })

  it('is disabled and says why when the agent prompt cannot be sent', () => {
    seed([makeWorktree({ id: 'wt-a', displayName: 'alpha' })])

    renderField({ unavailableReason: 'Pick an agent to send this prompt.' })

    expect(screen.getByRole('combobox')).toHaveProperty('disabled', true)
    expect(screen.getByText('Pick an agent to send this prompt.')).toBeTruthy()
  })
})
