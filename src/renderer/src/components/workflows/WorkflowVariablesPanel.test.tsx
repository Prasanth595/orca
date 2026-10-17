/** @vitest-environment happy-dom */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WorkflowVariablesPanel from './WorkflowVariablesPanel'

Object.assign(window, {
  api: { workflows: { listVariables: vi.fn(async () => []) } }
})

afterEach(cleanup)

describe('WorkflowVariablesPanel new-variable form', () => {
  it('renders every control at one consistent height', async () => {
    const { container } = render(<WorkflowVariablesPanel />)

    // SelectTrigger's data-[size] variant height cannot be overridden by a bare
    // h-7, so it must be created with size="sm" for the merge to apply.
    const trigger = container.querySelector('[data-slot="select-trigger"]')
    expect(trigger?.getAttribute('data-size')).toBe('sm')
    expect(trigger?.className).toContain('h-7')

    for (const input of container.querySelectorAll('[data-slot="input"]')) {
      expect(input.className).toContain('h-7')
    }

    for (const button of container.querySelectorAll('[data-slot="button"]')) {
      expect(button.className).toContain('h-7')
    }
  })
})
