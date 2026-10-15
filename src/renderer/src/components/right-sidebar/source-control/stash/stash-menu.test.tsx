// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { StashMenu } from './stash-menu'
import { StashDialogs } from './stash-dialogs'
import type { SourceControlStashActions } from './use-stash-actions'

vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
afterEach(cleanup)
function menuActions(): SourceControlStashActions {
  return {
    picker: null,
    save: null,
    view: null,
    busy: false,
    setPicker: vi.fn(),
    setSave: vi.fn(),
    setView: vi.fn(),
    selectStash: vi.fn(async () => {}),
    requestStashAction: vi.fn(async () => {}),
    saveStash: vi.fn(async () => {}),
    canStash: true,
    canStashUntracked: true,
    canStashStaged: false,
    hasConflicts: false
  }
}
describe('stash menu and dialogs', () => {
  it('opens the grouped submenu with the keyboard and dispatches Apply Last Stash', async () => {
    const actions = menuActions()
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <StashMenu disabled={false} actions={actions} />
        </DropdownMenuContent>
      </DropdownMenu>
    )
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Stash' }), { key: 'ArrowRight' })
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'View Stash…' })).toBeTruthy())
    for (const name of [
      'Stash (Include Untracked)',
      'Stash Staged',
      'Apply Last Stash',
      'Apply Stash…',
      'Pop Last Stash',
      'Pop Stash…',
      'Drop Stash…',
      'Drop All Stashes…',
      'View Stash…'
    ]) {
      expect(screen.getByRole('menuitem', { name })).toBeTruthy()
    }
    expect(
      screen.getByRole('menuitem', { name: 'Stash Staged' }).getAttribute('aria-disabled')
    ).toBe('true')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Apply Last Stash' }))
    expect(actions.requestStashAction).toHaveBeenCalledWith('apply_last')
  })
  it('searches stash subjects and sends the selected entry to the requested action', async () => {
    const actions = menuActions()
    const selected = { ref: 'stash@{1}', oid: 'b'.repeat(40), subject: 'feature settings' }
    actions.picker = {
      action: 'pop',
      context: { target: { kind: 'local' }, worktreeId: 'wt-1', worktreePath: '/repo' },
      entries: [{ ref: 'stash@{0}', oid: 'a'.repeat(40), subject: 'other edits' }, selected],
      loading: false,
      error: null,
      truncated: false
    }
    render(<StashDialogs actions={actions} />)
    fireEvent.change(screen.getByPlaceholderText('Search stashes…'), {
      target: { value: 'settings' }
    })
    await waitFor(() => expect(screen.queryByRole('option', { name: /other edits/ })).toBeNull())
    fireEvent.click(screen.getByRole('option', { name: /feature settings/ }))
    expect(actions.selectStash).toHaveBeenCalledWith(selected)
  })
  it('submits an optional stash message with Enter', () => {
    const actions = menuActions()
    actions.save = {
      action: 'push_untracked',
      context: { target: { kind: 'local' }, worktreeId: 'wt-1', worktreePath: '/repo' }
    }
    render(<StashDialogs actions={actions} />)
    const input = screen.getByLabelText('Message (optional)')
    fireEvent.change(input, { target: { value: 'before refactor' } })
    const form = input.closest('form')
    if (!form) {
      throw new Error('Missing stash form')
    }
    fireEvent.submit(form)
    expect(actions.saveStash).toHaveBeenCalledWith('before refactor')
  })
})
