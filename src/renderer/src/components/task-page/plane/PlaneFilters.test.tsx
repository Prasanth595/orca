// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PLANE_WORK_ITEM_FILTERS } from '@/store/slices/plane-slice-contract'
import { PlaneFilters } from './PlaneFilters'

afterEach(cleanup)

function renderFilters(overrides: Partial<Parameters<typeof PlaneFilters>[0]> = {}) {
  const props = {
    filters: DEFAULT_PLANE_WORK_ITEM_FILTERS,
    projects: [{ id: 'web', name: 'Web', identifier: 'WEB' }],
    states: [],
    assignees: [],
    refreshing: false,
    onChange: vi.fn(),
    onJumpToIdentifier: vi.fn(),
    onRefresh: vi.fn(),
    ...overrides
  }
  render(<PlaneFilters {...props} />)
  return props
}

describe('PlaneFilters', () => {
  it('starts on all scoped projects, open states, anyone and any priority', () => {
    renderFilters()
    expect(screen.getByRole('combobox', { name: 'Project' }).textContent).toContain('All in scope')
    expect(screen.getByRole('button', { name: 'State: Open' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Assignee' }).textContent).toContain('Anyone')
    expect(screen.getByRole('combobox', { name: 'Priority' }).textContent).toContain('Any priority')
  })

  it('names an exact state once one project is chosen', () => {
    renderFilters({
      filters: { ...DEFAULT_PLANE_WORK_ITEM_FILTERS, projectId: 'web', stateId: 's1' },
      states: [{ id: 's1', name: 'In Review', group: 'started', color: '', sequence: 1 }]
    })
    expect(screen.getByRole('button', { name: 'State: In Review' })).toBeTruthy()
  })

  it('filters by text and jumps to a typed identifier on Enter', () => {
    const props = renderFilters({
      filters: { ...DEFAULT_PLANE_WORK_ITEM_FILTERS, text: 'web-12' }
    })
    const search = screen.getByRole('textbox', { name: 'Search work items' })
    fireEvent.change(search, { target: { value: 'login' } })
    expect(props.onChange).toHaveBeenCalledWith({ text: 'login' })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(props.onJumpToIdentifier).toHaveBeenCalledWith('WEB-12')
  })

  it('does not jump for plain text', () => {
    const props = renderFilters({ filters: { ...DEFAULT_PLANE_WORK_ITEM_FILTERS, text: 'login' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search work items' }), { key: 'Enter' })
    expect(props.onJumpToIdentifier).not.toHaveBeenCalled()
  })

  it('refreshes on demand and disables while refreshing', () => {
    const props = renderFilters()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(props.onRefresh).toHaveBeenCalledOnce()
    cleanup()
    renderFilters({ refreshing: true })
    expect(screen.getByRole('button', { name: 'Refresh' })).toHaveProperty('disabled', true)
  })
})
