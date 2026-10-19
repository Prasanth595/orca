import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/userData'
  }
}))

import { getManagedScript as getClaudeManagedScript } from '../claude/hook-service'
import { getManagedScript as getCursorManagedScript } from '../cursor/hook-script'

const POSIX_CURSOR_GUARD = 'if [ -n "$CURSOR_VERSION" ] && [ -n "$CURSOR_PROJECT_DIR" ]; then'
const WINDOWS_CURSOR_GUARD =
  'if not "%CURSOR_VERSION%"=="" if not "%CURSOR_PROJECT_DIR%"=="" goto :orca_agent_hook_drain_stdin'
const CLAUDE_SCRIPT_OPTIONS = {
  skipWhenDevinImportsClaude: true,
  skipWhenGrokImportsClaude: true,
  skipWhenCursorImportsClaude: true
}

function withPlatform<T>(platform: NodeJS.Platform, run: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  try {
    return run()
  } finally {
    Object.defineProperty(process, 'platform', descriptor)
  }
}

function runPosixHook(
  script: string,
  hookEnv: Record<string, string>
): { curlCalled: boolean; stdout: string } {
  const dir = mkdtempSync(join(tmpdir(), 'orca-cursor-replay-'))
  const scriptPath = join(dir, 'hook.sh')
  const curlPath = join(dir, 'curl')
  const curlLog = join(dir, 'curl.log')
  try {
    writeFileSync(scriptPath, script)
    writeFileSync(
      curlPath,
      '#!/bin/sh\n{ command -p cat 2>/dev/null || cat; } >/dev/null\nprintf "called\\n" >> "$CURL_LOG"\n'
    )
    chmodSync(scriptPath, 0o755)
    chmodSync(curlPath, 0o755)

    const result = spawnSync('/bin/sh', [scriptPath], {
      encoding: 'utf8',
      input: '{"hook_event_name":"Stop"}',
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH ?? ''}`,
        CURL_LOG: curlLog,
        CURSOR_VERSION: '',
        CURSOR_PROJECT_DIR: '',
        ORCA_AGENT_HOOK_ENDPOINT: '',
        ORCA_AGENT_HOOK_PORT: '1234',
        ORCA_AGENT_HOOK_TOKEN: 'token',
        ORCA_PANE_KEY: 'tab:leaf',
        ...hookEnv
      }
    })

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    return { curlCalled: existsSync(curlLog), stdout: result.stdout }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('Cursor vendor hook replay guard', () => {
  it('precedes spooling and HTTP in the generated POSIX Claude script only', () => {
    const claude = getClaudeManagedScript('posix', CLAUDE_SCRIPT_OPTIONS)

    const guardIndex = claude.indexOf(POSIX_CURSOR_GUARD)
    expect(guardIndex).toBeGreaterThan(claude.indexOf('printf "{}\\n"'))
    expect(guardIndex).toBeLessThan(claude.indexOf('spool_hook_event'))
    expect(guardIndex).toBeLessThan(claude.indexOf('curl'))
    // Why: Cursor's own managed hook runs in the same environment and must keep reporting.
    expect(getCursorManagedScript('posix')).not.toContain(POSIX_CURSOR_GUARD)
  })

  it('precedes HTTP while preserving fail-open output in the generated Windows script', () => {
    const claude = withPlatform('win32', () =>
      getClaudeManagedScript('local', CLAUDE_SCRIPT_OPTIONS)
    )

    expect(claude.indexOf(WINDOWS_CURSOR_GUARD)).toBeGreaterThan(claude.indexOf('echo {}'))
    expect(claude.indexOf(WINDOWS_CURSOR_GUARD)).toBeLessThan(claude.indexOf('curl'))
  })

  it('is absent from scripts that do not import Claude hooks', () => {
    expect(getClaudeManagedScript('posix')).not.toContain('CURSOR_VERSION')
  })

  it.skipIf(process.platform === 'win32')(
    'drops Cursor-replayed Claude hooks without suppressing their protocol response',
    () => {
      const result = runPosixHook(getClaudeManagedScript('posix', CLAUDE_SCRIPT_OPTIONS), {
        CURSOR_VERSION: '2026.10.16',
        CURSOR_PROJECT_DIR: '/work/project'
      })
      expect(result.curlCalled).toBe(false)
      expect(result.stdout).toBe('{}\n')
    }
  )

  it.skipIf(process.platform === 'win32')(
    'keeps delivering real Claude hooks, including when only one Cursor name is present',
    () => {
      const script = getClaudeManagedScript('posix', CLAUDE_SCRIPT_OPTIONS)
      const hookEnvs: Record<string, string>[] = [
        {},
        { CURSOR_VERSION: '2026.10.16' },
        { CURSOR_PROJECT_DIR: '/p' }
      ]
      for (const hookEnv of hookEnvs) {
        const result = runPosixHook(script, hookEnv)
        expect(result.curlCalled).toBe(true)
        expect(result.stdout).toBe('{}\n')
      }
    }
  )
})
