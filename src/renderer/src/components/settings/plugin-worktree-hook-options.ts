import { useEffect, useState } from 'react'
import type { PluginHostListEntry, PluginHostWorktreeHook } from '../../../../preload/api-types'
import type { PluginHookSource } from '../../../../shared/orca-yaml-hook-types'

export type PluginWorktreeHookOption = {
  /** Select value; stable for one plugin contribution. */
  value: string
  source: PluginHookSource
  pluginName: string
  hook: PluginHostWorktreeHook
  /** False while the plugin is disabled, awaiting consent, invalid or blocked; Orca runs none of it then. */
  available: boolean
}

export function pluginHookSourceValue(source: PluginHookSource): string {
  return `${source.pluginKey}\0${source.contributionId}`
}

export function buildPluginWorktreeHookOptions(
  plugins: readonly PluginHostListEntry[]
): PluginWorktreeHookOption[] {
  return plugins.flatMap((plugin) =>
    (plugin.worktreeHooks ?? []).map((hook) => {
      const source = { pluginKey: plugin.pluginKey, contributionId: hook.id }
      return {
        value: pluginHookSourceValue(source),
        source,
        pluginName: plugin.name,
        hook,
        available:
          plugin.status !== 'pending' &&
          plugin.status !== 'disabled' &&
          plugin.status !== 'invalid' &&
          !plugin.needsReconsent &&
          !plugin.blockedByKillList
      }
    })
  )
}

/** Hook contributions of this desktop's plugins; empty when the plugin system is off. */
export function usePluginWorktreeHookOptions(enabled: boolean): PluginWorktreeHookOption[] {
  const [options, setOptions] = useState<PluginWorktreeHookOption[]>([])

  useEffect(() => {
    const plugins = window.api?.plugins
    if (!enabled || !plugins) {
      setOptions([])
      return undefined
    }
    let disposed = false
    const load = (): void => {
      void plugins
        .list()
        .then((entries) => {
          if (!disposed) {
            setOptions(buildPluginWorktreeHookOptions(entries))
          }
        })
        .catch(() => {
          if (!disposed) {
            setOptions([])
          }
        })
    }
    load()
    const unsubscribe = plugins.onChanged?.(load)
    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [enabled])

  return options
}
