// @vitest-environment happy-dom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlaneProject } from '../../../../shared/plane-types'
import type { PlaneScopeDraft } from './plane-connect-form-model'
import { PlaneProjectScopePicker } from './PlaneProjectScopePicker'

const PROJECTS: PlaneProject[] = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Web', identifier: 'WEB' },
  { id: '22222222-2222-4222-8222-222222222222', name: 'API', identifier: 'API' },
  { id: '33333333-3333-4333-8333-333333333333', name: 'Docs', identifier: 'DOC' }
]

afterEach(cleanup)

function Harness({
  initial,
  onChange
}: {
  initial: PlaneScopeDraft
  onChange: (value: PlaneScopeDraft) => void
}): React.JSX.Element {
  const [value, setValue] = useState(initial)
  return (
    <PlaneProjectScopePicker
      projects={PROJECTS}
      value={value}
      onChange={(next) => {
        setValue(next)
        onChange(next)
      }}
    />
  )
}

describe('PlaneProjectScopePicker', () => {
  it('starts with neither mode chosen and hides the project list', () => {
    render(<Harness initial={null} onChange={vi.fn()} />)
    expect(screen.getAllByRole('radio').map((radio) => radio.getAttribute('aria-checked'))).toEqual(
      ['false', 'false']
    )
    expect(screen.queryByPlaceholderText('Search projects')).toBeNull()
  })

  it('chooses all projects without listing them', () => {
    const onChange = vi.fn()
    render(<Harness initial={null} onChange={onChange} />)
    fireEvent.click(
      screen.getByRole('radio', { name: /All projects \(includes projects added later\)/ })
    )
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'all' })
    expect(screen.queryByText('Web')).toBeNull()
  })

  it('counts, selects all and selects none', () => {
    const onChange = vi.fn()
    render(<Harness initial={{ mode: 'selected', projectIds: [] }} onChange={onChange} />)
    expect(screen.getByText('0 of 3 selected')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }))
    expect(onChange).toHaveBeenLastCalledWith({
      mode: 'selected',
      projectIds: PROJECTS.map((project) => project.id)
    })
    expect(screen.getByText('3 of 3 selected')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Select none' }))
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'selected', projectIds: [] })
  })

  it('filters by name or identifier and toggles a single project', () => {
    const onChange = vi.fn()
    render(<Harness initial={{ mode: 'selected', projectIds: [] }} onChange={onChange} />)
    fireEvent.change(screen.getByPlaceholderText('Search projects'), { target: { value: 'doc' } })
    expect(screen.queryByText('Web')).toBeNull()
    fireEvent.click(screen.getByText('Docs'))
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'selected', projectIds: [PROJECTS[2].id] })
    fireEvent.click(screen.getByText('Docs'))
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'selected', projectIds: [] })
  })

  it('switches a selection to all projects', () => {
    const onChange = vi.fn()
    render(
      <Harness initial={{ mode: 'selected', projectIds: [PROJECTS[1].id] }} onChange={onChange} />
    )
    fireEvent.click(screen.getByRole('radio', { name: /All projects/ }))
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'all' })
  })

  it('says when the token can see no projects', () => {
    render(
      <PlaneProjectScopePicker
        projects={[]}
        value={{ mode: 'selected', projectIds: [] }}
        onChange={vi.fn()}
      />
    )
    expect(screen.getByText('No projects are available to this token.')).toBeTruthy()
  })
})
