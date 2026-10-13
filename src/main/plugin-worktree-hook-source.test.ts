import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultTabsLaunch, getEffectiveHooksFromConfig } from './effective-hook-config'
import { makeHookTestRepo } from './hooks-test-fixtures'
import { getLocalHookScripts, setPluginWorktreeHookResolver } from './plugin-worktree-hook-source'
import {
  resolvePluginWorktreeHookScripts,
  type PluginWorktreeHookLookup
} from './plugins/plugin-worktree-hooks'

const SOURCE = { pluginKey: 'ewilazarus.git-workspace', contributionId: 'git-workspace' }
const PLUGIN_SCRIPTS = { setup: 'orca-git-workspace setup', archive: 'orca-git-workspace archive' }

function pluginRepo(extra: Record<string, unknown> = {}) {
  return makeHookTestRepo({
    mode: 'auto',
    scripts: { setup: 'my own setup', archive: 'my own archive' },
    pluginHookSource: SOURCE,
    ...extra
  })
}

afterEach(() => setPluginWorktreeHookResolver(null))

describe('getLocalHookScripts', () => {
  it("uses the user's scripts when no plugin is picked", () => {
    setPluginWorktreeHookResolver(() => PLUGIN_SCRIPTS)
    const repo = makeHookTestRepo({ mode: 'auto', scripts: { setup: 'mine', archive: '' } })
    expect(getLocalHookScripts(repo)).toEqual({ setup: 'mine', archive: '' })
  })

  it("uses the picked plugin's commands in place of the user's scripts", () => {
    const resolver = vi.fn(() => PLUGIN_SCRIPTS)
    setPluginWorktreeHookResolver(resolver)
    expect(getLocalHookScripts(pluginRepo())).toEqual(PLUGIN_SCRIPTS)
    expect(resolver).toHaveBeenCalledWith(SOURCE)
  })

  it("runs nothing when the plugin is unavailable, never falling back to the user's scripts", () => {
    setPluginWorktreeHookResolver(() => null)
    expect(getLocalHookScripts(pluginRepo())).toEqual({})
    // Headless hosts install no resolver at all.
    setPluginWorktreeHookResolver(null)
    expect(getLocalHookScripts(pluginRepo())).toEqual({})
  })
})

describe('plugin hooks through the existing hook policies', () => {
  it('act as local scripts, so an unset source policy defaults to local-only', () => {
    setPluginWorktreeHookResolver(() => PLUGIN_SCRIPTS)
    const yaml = { scripts: { setup: 'yaml setup', archive: 'yaml archive' } }
    expect(getEffectiveHooksFromConfig(pluginRepo(), yaml)).toEqual({ scripts: PLUGIN_SCRIPTS })
    expect(
      getDefaultTabsLaunch({ ...yaml, defaultTabs: [{ command: 'x' }] }, pluginRepo())
    ).toEqual(expect.objectContaining({ runCommands: false }))
  })

  it('honor run-both and shared-only like hand-typed local scripts', () => {
    setPluginWorktreeHookResolver(() => PLUGIN_SCRIPTS)
    const yaml = { scripts: { setup: 'yaml setup' } }
    expect(
      getEffectiveHooksFromConfig(pluginRepo({ commandSourcePolicy: 'run-both' }), yaml)
    ).toEqual({
      scripts: {
        setup: 'yaml setup\norca-git-workspace setup',
        archive: 'orca-git-workspace archive'
      }
    })
    expect(
      getEffectiveHooksFromConfig(pluginRepo({ commandSourcePolicy: 'shared-only' }), yaml)
    ).toEqual({ scripts: { setup: 'yaml setup' } })
  })

  it('leave the committed orca.yaml in charge once the plugin is gone', () => {
    setPluginWorktreeHookResolver(() => null)
    const yaml = { scripts: { setup: 'yaml setup' } }
    expect(getEffectiveHooksFromConfig(pluginRepo(), yaml)).toEqual({
      scripts: { setup: 'yaml setup' }
    })
  })
})

describe('resolvePluginWorktreeHookScripts', () => {
  function service(granted: string[] | null): PluginWorktreeHookLookup {
    return {
      getGrantedCapabilities: () => granted,
      findValidPlugin: () => ({
        manifest: {
          contributes: {
            worktreeHooks: [{ id: 'git-workspace', title: 'Lifecycle', ...PLUGIN_SCRIPTS }]
          }
        }
      })
    }
  }

  it('returns the contribution only while the plugin holds a live repo:hooks grant', () => {
    expect(resolvePluginWorktreeHookScripts(service(['repo:hooks']), SOURCE)).toEqual(
      PLUGIN_SCRIPTS
    )
    expect(resolvePluginWorktreeHookScripts(service(null), SOURCE)).toBeNull()
    expect(resolvePluginWorktreeHookScripts(service(['storage']), SOURCE)).toBeNull()
    expect(resolvePluginWorktreeHookScripts(null, SOURCE)).toBeNull()
  })

  it('returns nothing for a contribution the plugin no longer ships', () => {
    expect(
      resolvePluginWorktreeHookScripts(service(['repo:hooks']), {
        ...SOURCE,
        contributionId: 'removed'
      })
    ).toBeNull()
  })
})
