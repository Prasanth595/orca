import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { parse as parseToml } from 'smol-toml'
import { getSystemCodexHomePath } from './codex-home-paths'

const SYSTEM_CODEX_CONFIG_PATH = '/etc/codex/config.toml'

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

function userConfigPaths(
  homePaths: readonly (string | null | undefined)[],
  systemConfigPath: string | null
): string[] {
  const paths = [
    join(process.env.CODEX_HOME?.trim() || getSystemCodexHomePath(), 'config.toml'),
    ...homePaths.filter((home): home is string => Boolean(home)).map((h) => join(h, 'config.toml')),
    ...(systemConfigPath ? [systemConfigPath] : [])
  ]
  return [...new Set(paths)]
}

function projectConfigPaths(cwd: string, excluded: ReadonlySet<string>): string[] {
  const paths: string[] = []
  let dir = resolve(cwd)
  for (;;) {
    const candidate = join(dir, '.codex', 'config.toml')
    // Why: a user config is read once, as a user layer.
    if (!excluded.has(candidate)) {
      paths.push(candidate)
    }
    const parent = dirname(dir)
    if (parent === dir) {
      return paths
    }
    dir = parent
  }
}

/**
 * True when any Codex config layer this host would load (user homes, system, or project
 * `.codex/config.toml` from cwd to root, regardless of Codex trust) sets `developer_instructions`
 * or selects a profile, or cannot be read.
 */
export async function codexConfigBlocksBrowserGuidance(input: {
  homePaths: readonly (string | null | undefined)[]
  cwd: string
  /** Defaults to /etc/codex/config.toml outside Windows; null skips the system layer. */
  systemConfigPath?: string | null
}): Promise<boolean> {
  const systemConfigPath =
    input.systemConfigPath !== undefined
      ? input.systemConfigPath
      : process.platform === 'win32'
        ? null
        : SYSTEM_CODEX_CONFIG_PATH
  const userPaths = userConfigPaths(input.homePaths, systemConfigPath)
  const paths = [...userPaths, ...projectConfigPaths(input.cwd, new Set(userPaths))]
  for (const path of paths) {
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
