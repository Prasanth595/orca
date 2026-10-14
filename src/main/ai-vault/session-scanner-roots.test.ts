import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AI_VAULT_AGENT_SOURCES } from './session-scanner-agent-sources'
import { ompSessionsRootDirs, uniqueNativeDirs } from './session-scanner-roots'

describe('claude session roots', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // The CLI writes to CLAUDE_CONFIG_DIR; History listed only ~/.claude while chat read both.
  it('lists the CLAUDE_CONFIG_DIR tree ahead of the default home', () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', '/opt/claude-home')

    expect(
      AI_VAULT_AGENT_SOURCES.claude.rootDirs({ claudeProfileProjectsDirs: [] }, ['/wsl/home/ada'])
    ).toEqual([
      join('/opt/claude-home', 'projects'),
      join(homedir(), '.claude', 'projects'),
      join('/wsl/home/ada', '.claude', 'projects')
    ])
  })

  it('keeps an explicit root as the only host root', () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', '/opt/claude-home')

    expect(
      AI_VAULT_AGENT_SOURCES.claude.rootDirs(
        { claudeProjectsDir: '/scan/projects', claudeProfileProjectsDirs: [] },
        []
      )
    ).toEqual(['/scan/projects'])
  })
})

describe('uniqueNativeDirs', () => {
  // A merged scan walks each root it is given, so a respelled alias doubles every
  // session it finds there and the duplicates crowd out the per-agent limit.
  it('collapses Windows roots that differ only in case or separator', () => {
    expect(
      uniqueNativeDirs(
        [
          'C:\\Users\\Ada\\.hermes\\sessions',
          'C:/Users/ada/.HERMES/sessions',
          'C:\\Users\\Ada\\AppData\\Local\\hermes\\sessions'
        ],
        'win32'
      )
    ).toEqual([
      'C:\\Users\\Ada\\.hermes\\sessions',
      'C:\\Users\\Ada\\AppData\\Local\\hermes\\sessions'
    ])
  })

  it('keeps case-distinct roots everywhere else', () => {
    expect(
      uniqueNativeDirs(['/home/ada/.hermes/sessions', '/home/Ada/.hermes/sessions'], 'linux')
    ).toEqual(['/home/ada/.hermes/sessions', '/home/Ada/.hermes/sessions'])
  })
})

describe('ompSessionsRootDirs', () => {
  it('drops a degenerate root that would resolve to the process cwd', () => {
    // normalizeAgentSessionsDir('/') returns ''. Kept, that root would resolve()
    // to the cwd and allowlist it for renderer-supplied subagent paths.
    expect(ompSessionsRootDirs({ ompSessionsDir: '' })).toEqual([])
    expect(ompSessionsRootDirs({ ompSessionsDir: '   ' })).toEqual([])
  })

  it('keeps the host root and one root per distinct WSL distro home', () => {
    expect(
      ompSessionsRootDirs({
        ompSessionsDir: '/home/ada/.omp/agent/sessions',
        wslHomeDirs: ['/wsl/ubuntu/home/ada', '/wsl/ubuntu/home/ada', '  ']
      })
    ).toEqual([
      '/home/ada/.omp/agent/sessions',
      join('/wsl/ubuntu/home/ada', '.omp', 'agent', 'sessions')
    ])
  })
})
