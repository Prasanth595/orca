import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import { useAppStore } from '@/store'
import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'
import type { RuntimeTerminalResolvePane } from '../../../shared/runtime-terminal-contracts'
import { callRuntimeRpc } from './runtime-rpc-client'

type PaneTerminalTitleSync = {
  worktreeId: string
  tabId: string
  leafId: string
  title: string | null
}

/** Which runtime owns this worktree: a paired environment or this app. */
function runtimeTargetForWorktree(worktreeId: string): RuntimeClientTarget {
  const environmentId = getRuntimeEnvironmentIdForWorktree(useAppStore.getState(), worktreeId)
  return environmentId ? { kind: 'environment', environmentId } : { kind: 'local' }
}

async function mirrorPaneTitle({
  worktreeId,
  tabId,
  leafId,
  title
}: PaneTerminalTitleSync): Promise<void> {
  const target = runtimeTargetForWorktree(worktreeId)
  const resolved = await callRuntimeRpc<{ terminal: RuntimeTerminalResolvePane | null }>(
    target,
    'terminal.resolvePane',
    { paneKey: `${tabId}:${leafId}`, worktreeId }
  )
  if (!resolved.terminal) {
    return
  }
  await callRuntimeRpc(target, 'terminal.rename', {
    terminal: resolved.terminal.handle,
    title
  })
}

// Rapid edits must not let an older rename response overwrite a newer title.
const pendingSyncByPane = new Map<string, Promise<void>>()

/**
 * Mirror a pane-title rename to the owning runtime.
 *
 * Why: the pane title lives in the renderer's terminal layout. On a Web client
 * (and on a paired client with local PTYs) that layout never reaches the host,
 * so host-side consumers keep reporting the old title. `terminal.rename` is the
 * same host mutation the CLI uses; resolving the pane first keeps the mirror
 * correct when a tab has several panes.
 */
export function syncPaneTerminalTitle(args: PaneTerminalTitleSync): Promise<void> {
  const paneKey = `${args.tabId}:${args.leafId}`
  const previous = pendingSyncByPane.get(paneKey) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(() => mirrorPaneTitle(args))
  pendingSyncByPane.set(paneKey, next)
  void next.then(
    () => {
      if (pendingSyncByPane.get(paneKey) === next) {
        pendingSyncByPane.delete(paneKey)
      }
    },
    () => {
      if (pendingSyncByPane.get(paneKey) === next) {
        pendingSyncByPane.delete(paneKey)
      }
    }
  )
  return next
}
