import type { Terminal } from '@xterm/xterm'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { getExecutionHostIdForWorktree } from '@/lib/worktree-runtime-owner'
import { resolveWorktreeOperationRouteForHost } from '@/lib/worktree-operation-route'
import { attachOsFileDropOwner, createOsFileDropSequence } from '@/hooks/use-os-file-drop-owner'
import { getNativeFileDropRejectionMessage } from '@/lib/native-file-drop-rejection-message'
import { parseExecutionHostId } from '../../../../shared/execution-host'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import {
  hasWorkspaceFileDragType,
  readWorkspaceFileDragSource,
  readWorkspaceFileDragPaths,
  getWorkspaceFileDragRejectionMessage,
  isResolvedWorkspaceFileDragExecutionHost
} from '@/lib/workspace-file-drag'
import {
  handleInternalTerminalFileDrop,
  handleTerminalFileDrop
} from '../terminal-pane/terminal-drop-handler'
import { captureNativeTerminalFileDrop } from '../terminal-pane/terminal-native-file-drop-destination'
import type {
  TerminalDropSurface,
  TerminalDropTransport
} from '../terminal-pane/terminal-drop-surface'
import type { PreviewTerminalWorkspace } from './agent-terminal-preview-props'
import { terminalPreviewApiFor } from './terminal-preview-api'

export function installPreviewTerminalFileDrop(args: {
  container: HTMLElement
  terminal: Terminal
  ptyId: string
  workspace: PreviewTerminalWorkspace
  isCurrent: () => boolean
}): () => void {
  const { container, workspace } = args
  let disposed = false
  const isCurrent = (): boolean =>
    !disposed &&
    container.isConnected &&
    args.isCurrent() &&
    getExecutionHostIdForWorktree(useAppStore.getState(), workspace.worktreeId) ===
      workspace.executionHostId
  const leafId = workspace.paneKey ? parsePaneKey(workspace.paneKey)?.leafId : undefined
  const pane = { id: 0, leafId: leafId ?? args.ptyId, container, terminal: args.terminal }
  const manager: TerminalDropSurface = {
    getPanes: () => (isCurrent() ? [pane] : []),
    getActivePane: () => (isCurrent() ? pane : null)
  }
  const host = parseExecutionHostId(workspace.executionHostId)
  const transport: TerminalDropTransport = {
    getPtyId: () => args.ptyId,
    isConnected: isCurrent,
    sendInput: () => false,
    sendInputAccepted: (data) => terminalPreviewApiFor(args.ptyId).input(args.ptyId, data),
    getExecutionHostId: () => workspace.executionHostId,
    // Upload and quoting follow the card's host, which may differ from the workspace's default.
    getRuntimeEnvironmentId: () =>
      resolveWorktreeOperationRouteForHost(
        useAppStore.getState(),
        workspace.worktreeId,
        workspace.executionHostId
      )?.runtimeEnvironmentId ?? null,
    getConnectionId: () => (host?.kind === 'ssh' ? host.targetId : null)
  }
  const paneTransports = new Map([[pane.id, transport]])
  const dropArgs = {
    manager,
    paneTransports,
    worktreeId: workspace.worktreeId,
    tabId: workspace.tabId,
    cwd: workspace.cwd
  }
  const sequence = createOsFileDropSequence()
  const detachOsDrop = attachOsFileDropOwner(container, () => ({
    consumer: 'agent' as const,
    sequence,
    canAccept: isCurrent,
    captureDestination: () => captureNativeTerminalFileDrop({ ...dropArgs, pane }),
    onDrop: async (prepared, { destination }) => {
      for (const failure of prepared.failures) {
        const message = getNativeFileDropRejectionMessage(failure)
        toast.error(message.title, { description: message.description })
      }
      if (isCurrent()) {
        await destination?.(prepared.paths)
      }
    }
  }))
  const onDragOver = (event: DragEvent): void => {
    if (!event.dataTransfer || !hasWorkspaceFileDragType(event.dataTransfer)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = isCurrent() ? 'copy' : 'none'
  }
  const onDrop = (event: DragEvent): void => {
    const dataTransfer = event.dataTransfer
    if (!dataTransfer || !hasWorkspaceFileDragType(dataTransfer)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    if (!isCurrent()) {
      return
    }
    const source = readWorkspaceFileDragSource(dataTransfer)
    if (!source || !isResolvedWorkspaceFileDragExecutionHost(source.executionHostId)) {
      return
    }
    if (source.executionHostId === workspace.executionHostId) {
      void handleInternalTerminalFileDrop({ ...dropArgs, dataTransfer, dropTarget: container })
      return
    }
    if (source.executionHostId === 'local') {
      const paths = readWorkspaceFileDragPaths(dataTransfer)
      if (paths.status === 'rejected') {
        toast.error(getWorkspaceFileDragRejectionMessage(paths.reason))
        return
      }
      void handleTerminalFileDrop({ ...dropArgs, pane, paths: paths.paths })
      return
    }
    toast.error(
      translate(
        'sessionGrid.drop.differentHost',
        'Files from another remote host cannot be dropped here.'
      )
    )
  }
  container.addEventListener('dragover', onDragOver)
  container.addEventListener('drop', onDrop)
  return () => {
    disposed = true
    detachOsDrop()
    container.removeEventListener('dragover', onDragOver)
    container.removeEventListener('drop', onDrop)
  }
}
