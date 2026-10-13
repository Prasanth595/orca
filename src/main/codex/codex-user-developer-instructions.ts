import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { parse as parseToml } from 'smol-toml'
import type { AgentStartupSettings } from '../../shared/agent-startup-plan-inputs'
import type { TuiAgent } from '../../shared/tui-agent'
import { isWslUncPath } from '../../shared/wsl-paths'
import { getSystemCodexHomePath } from './codex-home-paths'

function resolveCodexConfigPath(homePath?: string): string {
  return join(
    homePath ?? (process.env.CODEX_HOME?.trim() || getSystemCodexHomePath()),
    'config.toml'
  )
}

function hasDeveloperInstructions(value: unknown): boolean {
  return (
    typeof value === 'object' && value !== null && Object.hasOwn(value, 'developer_instructions')
  )
}

/**
 * True when a layer sets `developer_instructions` or selects a profile; unparsable is treated as set.
 * Why a bare `profile` counts: it can resolve against profiles defined in any other layer.
 */
function configContentBlocksGuidance(content: string): boolean {
  try {
    const config = parseToml(content)
    return hasDeveloperInstructions(config) || typeof config.profile === 'string'
  } catch {
    return true
  }
}

// Why: no config means nothing to clobber; any other read failure is unknown, so stay conservative.
function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function projectConfigPaths(cwd: string, userConfigPath: string): string[] {
  const paths: string[] = []
  let dir = resolve(cwd)
  for (;;) {
    const candidate = join(dir, '.codex', 'config.toml')
    // Why: the user's own config is read once, as the user config.
    if (candidate !== userConfigPath) {
      paths.push(candidate)
    }
    const parent = dirname(dir)
    if (parent === dir) {
      return paths
    }
    dir = parent
  }
}

/** Project `.codex/config.toml` files from cwd to the root are checked regardless of Codex trust. */
function configPathsToCheck(homePath: string | undefined, cwd: string | undefined): string[] {
  const userConfigPath = resolveCodexConfigPath(homePath)
  return [userConfigPath, ...(cwd ? projectConfigPaths(cwd, userConfigPath) : [])]
}

/** True when any Codex config layer (user, or a project from cwd to root) sets `developer_instructions` or a profile. */
export function codexUserConfigDefinesDeveloperInstructions(
  homePath?: string,
  cwd?: string
): boolean {
  return configPathsToCheck(homePath, cwd).some((path) => {
    try {
      return configContentBlocksGuidance(readFileSync(path, 'utf8'))
    } catch (error) {
      return !isMissingFile(error)
    }
  })
}

export async function codexUserConfigDefinesDeveloperInstructionsAsync(
  homePath?: string,
  cwd?: string
): Promise<boolean> {
  for (const path of configPathsToCheck(homePath, cwd)) {
    try {
      if (configContentBlocksGuidance(await readFile(path, 'utf8'))) {
        return true
      }
    } catch (error) {
      if (!isMissingFile(error)) {
        return true
      }
    }
  }
  return false
}

/**
 * Launch-plan input for a Codex launch that would receive the guidance.
 * Remote and WSL hosts keep their own config that is not read here, so they skip; a paired
 * headless runtime host is not detectable at these call sites and still reads the local config.
 */
export function codexUserDeveloperInstructionsInput(
  agent: TuiAgent,
  settings: AgentStartupSettings,
  host: { isRemote: boolean; path?: string }
): { codexUserDeveloperInstructions?: boolean } {
  if (agent !== 'codex' || settings.useOrcaBrowserForAgentWork !== true) {
    return {}
  }
  // Why: no launch directory means project configs cannot be checked, so skip.
  if (host.isRemote || host.path === undefined || isWslUncPath(host.path)) {
    return { codexUserDeveloperInstructions: true }
  }
  return {
    codexUserDeveloperInstructions: codexUserConfigDefinesDeveloperInstructions(
      undefined,
      host.path
    )
  }
}
