import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
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

/** True when top-level or the active profile sets `developer_instructions`; unparsable is treated as set. */
function configContentDefinesDeveloperInstructions(content: string): boolean {
  try {
    const config = parseToml(content)
    if (hasDeveloperInstructions(config)) {
      return true
    }
    const profile = config.profile
    if (typeof profile !== 'string') {
      return false
    }
    const { profiles } = config
    return (
      typeof profiles === 'object' &&
      profiles !== null &&
      hasDeveloperInstructions(Object.getOwnPropertyDescriptor(profiles, profile)?.value)
    )
  } catch {
    return true
  }
}

// Why: no config means nothing to clobber; any other read failure is unknown, so stay conservative.
function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/** True when the user's own Codex config sets `developer_instructions`, which Orca must not override. */
export function codexUserConfigDefinesDeveloperInstructions(homePath?: string): boolean {
  try {
    return configContentDefinesDeveloperInstructions(
      readFileSync(resolveCodexConfigPath(homePath), 'utf8')
    )
  } catch (error) {
    return !isMissingFile(error)
  }
}

export async function codexUserConfigDefinesDeveloperInstructionsAsync(
  homePath?: string
): Promise<boolean> {
  try {
    return configContentDefinesDeveloperInstructions(
      await readFile(resolveCodexConfigPath(homePath), 'utf8')
    )
  } catch (error) {
    return !isMissingFile(error)
  }
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
  if (host.isRemote || (host.path !== undefined && isWslUncPath(host.path))) {
    return { codexUserDeveloperInstructions: true }
  }
  return { codexUserDeveloperInstructions: codexUserConfigDefinesDeveloperInstructions() }
}
