// @vitest-environment happy-dom

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePlaneHostScope } from '@/components/plane/plane-host-scope'
import { JiraSetupSteps, PlaneSetupSteps } from './TaskSourceSimpleSetup'

const mocks = vi.hoisted(() => {
  const dialogOpen: boolean[] = []
  const planeDialogTargets: unknown[] = []
  return { dialogOpen, planeDialogTargets }
})

vi.mock('@/components/jira-connect-dialog', () => ({
  JiraConnectDialog: ({ open }: { open: boolean }) => {
    mocks.dialogOpen.push(open)
    return null
  }
}))

vi.mock('@/components/plane/PlaneConnectDialog', () => ({
  PlaneConnectDialog: () => {
    // Why the real hook: the dialog throws without a host scope above it.
    mocks.planeDialogTargets.push(usePlaneHostScope().target)
    return null
  }
}))

afterEach(() => {
  cleanup()
  mocks.dialogOpen = []
  mocks.planeDialogTargets = []
})

describe('JiraSetupSteps', () => {
  it('routes connected credential management to Integrations', () => {
    const onOpenIntegrations = vi.fn()
    const rendered = render(
      <JiraSetupSteps
        connected
        checking={false}
        visible
        canHide
        onToggleVisible={vi.fn()}
        onConnected={vi.fn()}
        onOpenIntegrations={onOpenIntegrations}
      />
    )

    fireEvent.click(rendered.getByRole('button', { name: 'Manage keys' }))

    expect(onOpenIntegrations).toHaveBeenCalledOnce()
    expect(mocks.dialogOpen.at(-1)).toBe(false)
  })
})

describe('PlaneSetupSteps', () => {
  it('gives the connect dialog the Settings host scope', () => {
    const rendered = render(
      <PlaneSetupSteps
        connected={false}
        checking={false}
        visible
        canHide
        onToggleVisible={vi.fn()}
        onOpenIntegrations={vi.fn()}
        host={{ kind: 'local' }}
      />
    )

    expect(rendered.getByRole('button', { name: 'Connect Plane' })).toBeTruthy()
    expect(mocks.planeDialogTargets.at(-1)).toEqual({ kind: 'local' })
  })
})
