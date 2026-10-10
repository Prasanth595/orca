// @vitest-environment happy-dom

import { terminalHarness } from './__mocks__/preview-terminal-input'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AgentTerminalPreview } from './AgentTerminalPreview'
import type { NativeTerminalFileDropArgs } from '../terminal-pane/terminal-native-file-drop-destination'
import { OS_FILE_DROP_OWNER_ATTRIBUTE } from '../../../../shared/native-file-drop-preparation'
import { captureTerminalDropTarget } from '../terminal-pane/terminal-drop-target'
import { writeTerminalDropPathsToCapturedTarget } from '../terminal-pane/terminal-drop-path-writer'
import { WORKSPACE_FILE_PATH_MIME, writeWorkspaceFileDragSource } from '@/lib/workspace-file-drag'
import type { TerminalPreviewDataPayload } from '../../../../shared/terminal-preview'
import type { ExecutionHostId } from '../../../../shared/execution-host'

const dropHarness = vi.hoisted(() => ({
  capture: vi.fn<(args: Omit<NativeTerminalFileDropArgs, 'paths'>) => void>(),
  deliver: vi.fn<(paths: string[]) => Promise<void>>(async () => undefined),
  native: vi.fn(),
  internal: vi.fn()
}))
const dropHost = vi.hoisted((): { value: ExecutionHostId } => ({ value: 'local' }))
vi.mock('@/lib/worktree-runtime-owner', () => ({
  getExecutionHostIdForWorktree: () => dropHost.value
}))
vi.mock('../terminal-pane/terminal-native-file-drop-destination', () => ({
  captureNativeTerminalFileDrop: (args: Omit<NativeTerminalFileDropArgs, 'paths'>) => {
    dropHarness.capture(args)
    return dropHarness.deliver
  }
}))
vi.mock('../terminal-pane/terminal-drop-handler', () => ({
  handleTerminalFileDrop: dropHarness.native,
  handleInternalTerminalFileDrop: dropHarness.internal
}))
const dataListeners = new Set<(data: TerminalPreviewDataPayload) => void>()
const input = vi.fn(async (_ptyId: string, _data: string) => true)
const workspace = {
  worktreeId: 'folder-a',
  tabId: 'tab-a',
  cwd: '/workspace',
  paneKey: 'leaf-a',
  executionHostId: 'local' as const
}

beforeEach(() => {
  terminalHarness.instances.length = 0
  dropHost.value = 'local'
  Object.assign(window, {
    api: {
      fs: {
        getPathForFile: (file: File) => `/tmp/${file.name}`,
        prepareDroppedPaths: vi.fn(async ({ paths }: { paths: string[] }) => ({
          paths,
          failures: []
        }))
      },
      terminalPreview: {
        connect: vi.fn(async () => ({
          snapshot: { data: '', cols: 80, rows: 24, seq: 1 },
          replay: []
        })),
        input,
        fit: vi.fn(async (_ptyId: string, cols: number, rows: number) => ({ cols, rows })),
        ack: vi.fn(),
        unsubscribe: vi.fn(),
        onData: (listener: (data: TerminalPreviewDataPayload) => void) => {
          dataListeners.add(listener)
          return () => dataListeners.delete(listener)
        }
      }
    }
  })
})

const OWNER_SELECTOR = `[${OS_FILE_DROP_OWNER_ATTRIBUTE}]`

async function dispatchOsDrop(container: HTMLElement): Promise<void> {
  const owner = container.querySelector(OWNER_SELECTOR)
  if (!owner) {
    throw new Error('No preview drop target')
  }
  const event = new Event('drop', { bubbles: true, cancelable: true, composed: true })
  Object.defineProperty(event, 'isTrusted', { value: true })
  Object.defineProperty(event, 'dataTransfer', {
    value: { types: ['Files'], files: [new File([], 'a b.txt')], dropEffect: 'move' }
  })
  await act(async () => {
    owner.dispatchEvent(event)
  })
  await act(async () => undefined)
}

function capturedDropArgs(): Omit<NativeTerminalFileDropArgs, 'paths'> {
  const args = dropHarness.capture.mock.calls[0]?.[0]
  if (!args) {
    throw new Error('Missing captured destination')
  }
  return args
}

it.each(['unmount', 'replace', 'host-change'] as const)(
  'cancels a pending upload after %s',
  async (change) => {
    const view = render(<AgentTerminalPreview ptyId="pty-a" workspace={workspace} />)
    await waitFor(() => expect(terminalHarness.instances).toHaveLength(1))
    await dispatchOsDrop(view.container)
    const args = capturedDropArgs()
    const pane = args.manager.getActivePane()
    const transport = pane && args.paneTransports.get(pane.id)
    if (!pane || !transport) {
      throw new Error('Missing captured destination')
    }
    const dropTarget = captureTerminalDropTarget(pane, transport)
    if (change === 'unmount') {
      view.unmount()
    } else if (change === 'replace') {
      view.rerender(<AgentTerminalPreview ptyId="pty-b" workspace={workspace} />)
    } else {
      dropHost.value = 'ssh:other'
    }
    const result = await writeTerminalDropPathsToCapturedTarget({
      ...args,
      dropTarget,
      paths: ['/remote/uploaded.txt'],
      targetShell: 'posix'
    })
    expect(result.failureReason).toBe('target-stale')
    expect(input).not.toHaveBeenCalled()
  }
)

it('uses the existing path writer with the captured preview PTY', async () => {
  const view = render(<AgentTerminalPreview ptyId="pty-a" workspace={workspace} />)
  await waitFor(() => expect(terminalHarness.instances).toHaveLength(1))
  await dispatchOsDrop(view.container)
  const args = capturedDropArgs()
  const pane = args.manager.getActivePane()
  const transport = pane && args.paneTransports.get(pane.id)
  if (!pane || !transport) {
    throw new Error('Missing captured destination')
  }
  const result = await writeTerminalDropPathsToCapturedTarget({
    ...args,
    dropTarget: captureTerminalDropTarget(pane, transport),
    paths: ['/tmp/a b.txt', '/tmp/$HOME.txt'],
    targetShell: 'posix'
  })
  expect(result.pathsWritten).toBe(2)
  expect(input.mock.calls).toEqual([
    ['pty-a', "'/tmp/a b.txt' "],
    ['pty-a', "'/tmp/$HOME.txt' "]
  ])
})

it.each([
  ['local', 'local', 'internal'],
  ['local', 'ssh:destination', 'native'],
  ['ssh:destination', 'ssh:destination', 'internal'],
  ['ssh:other', 'ssh:destination', 'rejected']
] as const)(
  'routes an internal file from %s to %s through %s',
  async (source, destination, route) => {
    dropHost.value = destination
    const view = render(
      <AgentTerminalPreview
        ptyId="pty-a"
        workspace={{ ...workspace, executionHostId: destination }}
      />
    )
    await waitFor(() => expect(terminalHarness.instances).toHaveLength(1))
    const target = view.container.querySelector(OWNER_SELECTOR)
    if (!target) {
      throw new Error('Missing drop surface')
    }
    const dataTransfer = new DataTransfer()
    dataTransfer.setData(WORKSPACE_FILE_PATH_MIME, '/source/a b.txt')
    writeWorkspaceFileDragSource(dataTransfer, {
      workspaceId: 'source-folder',
      executionHostId: source
    })
    const event = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
    await act(async () => {
      target.dispatchEvent(event)
    })
    expect(dropHarness.native).toHaveBeenCalledTimes(route === 'native' ? 1 : 0)
    expect(dropHarness.internal).toHaveBeenCalledTimes(route === 'internal' ? 1 : 0)
  }
)
afterEach(() => {
  cleanup()
  dataListeners.clear()
  vi.clearAllMocks()
})

it('delivers an OS drop to the one preview it landed on when two show the same tab', async () => {
  const first = render(<AgentTerminalPreview ptyId="pty-a" workspace={workspace} />)
  render(<AgentTerminalPreview ptyId="pty-a" workspace={workspace} />)
  await waitFor(() => expect(terminalHarness.instances).toHaveLength(2))
  const surface = first.container.querySelector<HTMLElement>(OWNER_SELECTOR)
  expect(surface).toBe(first.container.querySelector('.origin-bottom-left')?.parentElement)
  await dispatchOsDrop(first.container)
  expect(dropHarness.capture).toHaveBeenCalledTimes(1)
  expect(capturedDropArgs()).toMatchObject({ worktreeId: 'folder-a', tabId: 'tab-a', cwd: '/workspace' })
  expect(dropHarness.deliver).toHaveBeenCalledWith(['/tmp/a b.txt'])
})

it('keeps one drop owner across a reconnection', async () => {
  const view = render(<AgentTerminalPreview ptyId="pty-a" workspace={workspace} />)
  await waitFor(() => expect(terminalHarness.instances).toHaveLength(1))
  await act(async () => {
    for (const listener of dataListeners) {
      listener({ type: 'resync', ptyId: 'pty-a' })
    }
  })
  await dispatchOsDrop(view.container)
  expect(dropHarness.capture).toHaveBeenCalledTimes(1)
  expect(dropHarness.deliver).toHaveBeenCalledTimes(1)
})

it('drops nothing once the workspace moved to another host', async () => {
  const view = render(<AgentTerminalPreview ptyId="pty-a" workspace={workspace} />)
  await waitFor(() => expect(terminalHarness.instances).toHaveLength(1))
  dropHost.value = 'ssh:other'
  await dispatchOsDrop(view.container)
  expect(dropHarness.capture).not.toHaveBeenCalled()
  expect(dropHarness.deliver).not.toHaveBeenCalled()
})
