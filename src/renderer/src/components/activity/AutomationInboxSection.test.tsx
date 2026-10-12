// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { StrictMode } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { AutomationInboxSection } from './AutomationInboxSection'
import { TooltipProvider } from '../ui/tooltip'
import { makeAutomationInboxEntry } from '../../../../shared/automation-inbox-test-fixture'
import {
  normalizeAutomationInboxEntries,
  countAutomationInboxUnread
} from '../../../../shared/automation-inbox'
import { parseHostStableKey } from '../../../../shared/automation-owner-key'

beforeEach(() => {
  useAppStore.setState({
    automationInboxEntries: {},
    runtimeEnvironments: [],
    sshTargetLabels: new Map()
  })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      notifications: { dismiss: vi.fn() },
      ui: { set: vi.fn().mockResolvedValue(undefined) }
    }
  })
})
afterEach(cleanup)

it('shows a failure with no terminal and opens its remote run while clearing the unread badge', async () => {
  const entry = makeAutomationInboxEntry({}, 'host:runtime:env-1:self')
  useAppStore.getState().receiveAutomationInbox(normalizeAutomationInboxEntries({ entry }))
  render(
    <StrictMode>
      <TooltipProvider>
        <AutomationInboxSection query="" readFilter="all" />
      </TooltipProvider>
    </StrictMode>
  )
  expect(screen.getByText('Login expired')).toBeInTheDocument()
  expect(countAutomationInboxUnread(useAppStore.getState().automationInboxEntries)).toBe(1)
  await userEvent.setup().click(screen.getByRole('button', { name: /Nightly run 1/ }))
  expect(countAutomationInboxUnread(useAppStore.getState().automationInboxEntries)).toBe(0)
  expect(useAppStore.getState().pendingAutomationRunNavigation).toMatchObject({
    runId: 'run-1',
    catalogRef: parseHostStableKey(entry.catalogKey)
  })
})

it('supports marking read/unread and clearing without replaying the cleared row', async () => {
  const entry = makeAutomationInboxEntry()
  const records = normalizeAutomationInboxEntries({ entry })
  useAppStore.getState().receiveAutomationInbox(records)
  render(<AutomationInboxSection query="" readFilter="all" />, { wrapper: TooltipProvider })
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Mark automation alert read' }))
  await user.click(screen.getByRole('button', { name: 'Mark automation alert unread' }))
  expect(countAutomationInboxUnread(useAppStore.getState().automationInboxEntries)).toBe(1)
  await user.click(screen.getByRole('button', { name: 'Dismiss automation alert' }))
  useAppStore.getState().receiveAutomationInbox(records)
  expect(screen.queryByText('Login expired')).toBeNull()
  expect(countAutomationInboxUnread(useAppStore.getState().automationInboxEntries)).toBe(0)
})

it('filters by failure text and keeps long inboxes virtualized', () => {
  const records = Object.fromEntries(
    Array.from({ length: 200 }, (_, index) => [
      String(index),
      makeAutomationInboxEntry({ runId: `run-${index}`, title: `Run ${index}`, createdAt: index })
    ])
  )
  useAppStore.getState().receiveAutomationInbox(normalizeAutomationInboxEntries(records))
  const view = render(<AutomationInboxSection query="Login expired" readFilter="unread" />, {
    wrapper: TooltipProvider
  })
  expect(document.querySelectorAll('[data-automation-inbox-row]').length).toBeLessThan(20)
  expect(document.querySelectorAll('[data-automation-inbox-row]').length).toBeGreaterThan(0)
  view.rerender(<AutomationInboxSection query="unmatched" readFilter="all" />)
  expect(screen.queryByRole('region', { name: 'Automation alerts' })).toBeNull()
})
