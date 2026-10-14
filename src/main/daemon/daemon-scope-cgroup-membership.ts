import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cgroupPathFromProcLine } from './daemon-user-manager-lifetime'

export const UNIT_NAME_PREFIX = 'orca-daemon-'
const LEGACY_SCOPE_PREFIX = 'app-orca-'

export function isLegacyDaemonScopeUnit(unit: string | null): boolean {
  return unit?.startsWith(LEGACY_SCOPE_PREFIX) === true && unit.endsWith('.scope')
}

function cgroupPathFromProc(contents: string): string | null {
  const paths: { path: string; priority: number }[] = []
  for (const line of contents.split('\n')) {
    const fields = line.split(':')
    const path = cgroupPathFromProcLine(line)
    if (fields.length >= 3 && path) {
      const controllers = fields[1]?.split(',') ?? []
      const priority = fields[0] === '0' ? 0 : controllers.includes('name=systemd') ? 1 : 2
      paths.push({ path, priority })
    }
  }
  return paths.sort((left, right) => left.priority - right.priority)[0]?.path ?? null
}

function scopeUnitFromCgroupPath(path: string): string | null {
  const unit = path.split('/').at(-1)?.trim()
  return unit?.endsWith('.scope') ? unit : null
}

export type LegacyDaemonScopeProcesses = {
  unit: string
  pids: number[]
}

export function readLegacyDaemonScopeProcesses(
  pid: number,
  procRoot = '/proc',
  cgroupRoot = '/sys/fs/cgroup'
): LegacyDaemonScopeProcesses | null {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return null
  }
  try {
    const cgroup = readFileSync(join(procRoot, String(pid), 'cgroup'), 'utf8')
    const path = cgroupPathFromProc(cgroup)
    const unit = path ? scopeUnitFromCgroupPath(path) : null
    if (unit === null || !isLegacyDaemonScopeUnit(unit) || !path) {
      return null
    }
    const legacyUnit = unit
    const pids = readFileSync(join(cgroupRoot, path.replace(/^\/+/, ''), 'cgroup.procs'), 'utf8')
      .split(/\s+/)
      .map(Number)
      .filter((value) => Number.isSafeInteger(value) && value > 0)
    return pids.length > 0 ? { unit: legacyUnit, pids } : null
  } catch {
    return null
  }
}

/**
 * The daemon's own cgroup membership, read from /proc rather than trusted from the launcher's
 * intent, so a daemon that fell back (or was adopted from before this fix) cannot misreport
 * isolation it does not have. The owning unit name when isolated; null when it sits in the
 * parent's service unit, is not on Linux, or has unreadable cgroup membership.
 */
export function detectOwnCgroupScopeUnit(
  platform: NodeJS.Platform = process.platform,
  cgroupPath = '/proc/self/cgroup'
): string | null {
  if (platform !== 'linux') {
    return null
  }
  let contents: string
  try {
    contents = readFileSync(cgroupPath, 'utf8')
  } catch {
    return null
  }
  for (const line of contents.split('\n')) {
    // cgroup v2 unified hierarchy: "0::/user.slice/.../orca-daemon-<nonce>.scope"
    // cgroup v1 systemd controller: "1:name=systemd:/user.slice/.../orca-daemon-<nonce>.scope"
    const last = line.split('/').at(-1)?.trim()
    if (last && (last.startsWith(UNIT_NAME_PREFIX) || isLegacyDaemonScopeUnit(last))) {
      return last
    }
  }
  return null
}
