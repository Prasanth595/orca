import type { PluginHookSource } from '../../shared/orca-yaml-hook-types'
import type { PluginWorktreeHookContribution } from '../../shared/plugins/plugin-content-pack-contributions'
import type { LocalHookScripts } from '../plugin-worktree-hook-source'

/** The slice of PluginService hook resolution reads. */
export type PluginWorktreeHookLookup = {
  getGrantedCapabilities(pluginKey: string): readonly string[] | null
  findValidPlugin(pluginKey: string): {
    manifest: { contributes: { worktreeHooks: readonly PluginWorktreeHookContribution[] } }
  } | null
}

/**
 * Read live on every hook run rather than snapshotted: `getGrantedCapabilities` answers only for a
 * consented, enabled, non-killed plugin, so revoking one stops its hooks at the very next run.
 */
export function resolvePluginWorktreeHookScripts(
  pluginService: PluginWorktreeHookLookup | null,
  source: PluginHookSource
): LocalHookScripts | null {
  if (!pluginService?.getGrantedCapabilities(source.pluginKey)?.includes('repo:hooks')) {
    return null
  }
  const hook = pluginService
    .findValidPlugin(source.pluginKey)
    ?.manifest.contributes.worktreeHooks.find((entry) => entry.id === source.contributionId)
  return hook ? { setup: hook.setup, archive: hook.archive } : null
}
