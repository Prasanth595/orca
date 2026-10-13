import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { resolveAbsoluteDirOverride } from './absolute-dir-override'

/** Hermes's home: an absolute `HERMES_HOME` replaces it, else the platform default below. */
export function resolveHermesHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  return resolveAbsoluteDirOverride(env.HERMES_HOME, resolveDefaultHermesHomeDir({ env }))
}

function isExistingDirectory(candidate: string): boolean {
  return statSync(candidate, { throwIfNoEntry: false })?.isDirectory() === true
}

/**
 * Hermes's home when `HERMES_HOME` is unset. Windows installs land in
 * `%LOCALAPPDATA%\hermes`, not a dotfolder in the user profile, so the POSIX
 * `~/.hermes` default finds nothing there. The dotfolder still wins on Windows
 * when it exists and the LOCALAPPDATA tree does not, which is the
 * pre-LOCALAPPDATA install Hermes itself keeps honouring rather than orphaning.
 */
export function resolveDefaultHermesHomeDir(
  input: {
    homeDir?: string
    env?: NodeJS.ProcessEnv
    platform?: NodeJS.Platform
    directoryExists?: (candidate: string) => boolean
  } = {}
): string {
  const platform = input.platform ?? process.platform
  const dotfolderHome = join(input.homeDir ?? homedir(), '.hermes')
  if (platform !== 'win32') {
    return dotfolderHome
  }
  const localAppData = resolveAbsoluteDirOverride(
    (input.env ?? process.env).LOCALAPPDATA,
    '',
    platform
  )
  if (!localAppData) {
    return dotfolderHome
  }
  const localAppDataHome = join(localAppData, 'hermes')
  const directoryExists = input.directoryExists ?? isExistingDirectory
  return !directoryExists(localAppDataHome) && directoryExists(dotfolderHome)
    ? dotfolderHome
    : localAppDataHome
}
