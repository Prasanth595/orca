import type { PluginHookSource } from '../shared/orca-yaml-hook-types'
import type { Repo } from '../shared/repo-types'

export type LocalHookScripts = { setup?: string; archive?: string }

/** Commands of a consented, enabled, non-revoked plugin's hook contribution; null otherwise. */
export type PluginWorktreeHookResolver = (source: PluginHookSource) => LocalHookScripts | null

let resolvePluginWorktreeHooks: PluginWorktreeHookResolver | null = null

/** Installed once by the desktop plugin service; headless hosts have none and resolve nothing. */
export function setPluginWorktreeHookResolver(resolver: PluginWorktreeHookResolver | null): void {
  resolvePluginWorktreeHooks = resolver
}

/**
 * The setup/archive commands that fill the project's "local" hook role: the plugin contribution the
 * user picked for this project, otherwise the scripts typed into Settings.
 */
export function getLocalHookScripts(repo: Repo): LocalHookScripts {
  const source = repo.hookSettings?.pluginHookSource
  if (!source) {
    return repo.hookSettings?.scripts ?? {}
  }
  // Why: fail closed. A disabled, revoked or removed plugin runs nothing, and the user's own
  // stored scripts stay off because they chose the plugin's instead.
  return resolvePluginWorktreeHooks?.(source) ?? {}
}
