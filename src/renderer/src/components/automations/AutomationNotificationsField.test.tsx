// @vitest-environment happy-dom
import { useState } from 'react'
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it } from 'vitest'
import { AutomationNotificationsField } from './AutomationNotificationsField'
import { buildAutomationEditDraft } from './automation-edit-draft'
import { makeAutomation } from './automations-page-fixtures'

afterEach(cleanup)

function Editor({ notifyOnFailure }: { notifyOnFailure?: boolean }): React.JSX.Element {
  const [draft, setDraft] = useState(buildAutomationEditDraft(makeAutomation({ notifyOnFailure })))
  return <AutomationNotificationsField draft={draft} onDraftChange={setDraft} />
}

it('starts opted out and lets the user turn reminders on and off by label and keyboard', async () => {
  const user = userEvent.setup()
  render(<Editor />)
  const toggle = screen.getByRole('switch', { name: 'Notify on failure' })
  expect(toggle).not.toBeChecked()
  expect(toggle).toHaveAccessibleDescription(/fails.*needs attention.*notification settings/)
  await user.click(screen.getByText('Notify on failure'))
  expect(toggle).toBeChecked()
  toggle.focus()
  await user.keyboard(' ')
  expect(toggle).not.toBeChecked()
})

it('restores the saved opt-in when editing an automation', () => {
  render(<Editor notifyOnFailure />)
  expect(screen.getByRole('switch', { name: 'Notify on failure' })).toBeChecked()
})
