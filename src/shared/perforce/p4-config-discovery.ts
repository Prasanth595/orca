import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** Config file names checked when nothing names one; `.p4config` is the conventional choice. */
export const P4CONFIG_CANDIDATES = ['.p4config', 'p4config.txt', '.p4config.txt'] as const

/**
 * The P4CONFIG name to use for a workspace when neither Settings > Perforce nor the environment
 * sets one. GUI-launched apps and orcad on an SSH host do not inherit the shell's P4CONFIG, so
 * without this a workspace's `.p4config` goes unread. `null` keeps p4's own resolution.
 */
export function discoverP4ConfigName(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
  readEnviro: (path: string) => string | null = readTextFile
): string | null {
  if (env.P4CONFIG?.trim() || enviroDefinesP4Config(env, readEnviro)) {
    return null
  }
  let dir = resolve(cwd)
  for (;;) {
    const found = P4CONFIG_CANDIDATES.find((name) => exists(join(dir, name)))
    if (found) {
      return found
    }
    const parent = dirname(dir)
    if (parent === dir) {
      return null
    }
    dir = parent
  }
}

function readTextFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** True when `p4 set` already chose a P4CONFIG name (P4ENVIRO file); that choice stays in charge. */
function enviroDefinesP4Config(
  env: NodeJS.ProcessEnv,
  readEnviro: (path: string) => string | null
): boolean {
  // Why not Windows: `p4 set` stores there in the registry, which p4 reads itself.
  const path =
    env.P4ENVIRO?.trim() || (process.platform === 'win32' ? '' : join(homedir(), '.p4enviro'))
  const text = path ? readEnviro(path) : null
  return text !== null && /^\s*P4CONFIG\s*=\s*\S/m.test(text)
}
