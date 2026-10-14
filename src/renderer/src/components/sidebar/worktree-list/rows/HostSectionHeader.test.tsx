// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { HostHeaderRow } from '../../host-section-rows'
import { HostSectionHeader } from './HostSectionHeader'

const state = vi.hoisted(() => ({
  settings: { hostSettingOverrides: {} },
  repos: [],
  worktreesByRepo: {},
  sshConnectionStates: new Map(),
  updateSettings: vi.fn().mockResolvedValue(undefined),
  openSettingsTarget: vi.fn(),
  openSettingsPage: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: Object.assign((selector: (value: typeof state) => unknown) => selector(state), {
    getState: () => state
  })
}))

vi.mock('@/runtime/runtime-rpc-client', () => ({ clearRuntimeCompatibilityCache: vi.fn() }))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, string>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values?.[key] ?? '')
}))

const row: HostHeaderRow = {
  type: 'host-header',
  key: 'host:local',
  hostId: 'local',
  kind: 'local',
  label: 'This computer',
  detail: '',
  health: 'local',
  collapsed: false,
  count: 1
}

function setup(host = row) {
  const onToggle = vi.fn()
  const onDragPointerDown = vi.fn()
  render(
    <TooltipProvider>
      <HostSectionHeader row={host} onToggle={onToggle} onDragPointerDown={onDragPointerDown} />
    </TooltipProvider>
  )
  return { user: userEvent.setup(), onToggle, onDragPointerDown }
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Host actions for This computer' }))
  return screen.findByRole('menu')
}

describe('HostSectionHeader actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(cleanup)

  it.each([
    row,
    { ...row, hostId: 'ssh:test', kind: 'ssh', health: 'available' },
    { ...row, hostId: 'runtime:test', kind: 'runtime', health: 'available' }
  ] satisfies HostHeaderRow[])(
    'opens Rename by mouse for $kind hosts without toggling',
    async (host) => {
      const { user, onToggle, onDragPointerDown } = setup(host)
      await openMenu(user)
      await user.click(screen.getByRole('menuitem', { name: 'Rename…' }))

      expect(await screen.findByRole('dialog', { name: 'Rename host' })).toBeTruthy()
      expect(screen.queryByRole('menu')).toBeNull()
      expect(onToggle).not.toHaveBeenCalled()
      expect(onDragPointerDown).not.toHaveBeenCalled()
    }
  )

  it('runs Manage host by mouse without toggling', async () => {
    const { user, onToggle } = setup()
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'Manage host…' }))

    expect(state.openSettingsTarget).toHaveBeenCalledWith({ pane: 'general', repoId: null })
    expect(state.openSettingsPage).toHaveBeenCalledOnce()
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('keeps keyboard menu navigation and activation working without toggling', async () => {
    const { user, onToggle } = setup()
    screen.getByRole('button', { name: 'Host actions for This computer' }).focus()
    await user.keyboard('{ArrowDown}')
    await screen.findByRole('menu')
    await user.keyboard('{Enter}')

    expect(await screen.findByRole('dialog', { name: 'Rename host' })).toBeTruthy()
    expect(onToggle).not.toHaveBeenCalled()
  })

  it.each(['click', 'Enter'])(
    'saves Rename with %s without toggling the host',
    async (activation) => {
      const { user, onToggle, onDragPointerDown } = setup()
      await openMenu(user)
      await user.click(screen.getByRole('menuitem', { name: 'Rename…' }))
      await user.type(screen.getByRole('textbox', { name: 'Display name' }), 'My computer')
      onToggle.mockClear()
      onDragPointerDown.mockClear()

      await (activation === 'click'
        ? user.click(screen.getByRole('button', { name: 'Save' }))
        : user.keyboard('{Enter}'))

      expect(state.updateSettings).toHaveBeenCalledWith({
        hostSettingOverrides: { local: { displayLabel: 'My computer' } }
      })
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(onToggle).not.toHaveBeenCalled()
      expect(onDragPointerDown).not.toHaveBeenCalled()
    }
  )

  it('still toggles the host from its label and from the focused header', async () => {
    const { user, onToggle } = setup()
    await user.click(screen.getByText('This computer'))
    expect(onToggle).toHaveBeenCalledOnce()

    const header = screen.getByRole('button', { expanded: true })
    fireEvent.keyDown(header, { key: 'Enter' })
    fireEvent.keyDown(header, { key: ' ' })
    expect(onToggle).toHaveBeenCalledTimes(3)
  })
})
