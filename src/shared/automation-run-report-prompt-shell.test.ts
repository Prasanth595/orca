import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runProcess } from '@orca/process-host'
import { describe, expect, it } from 'vitest'
import { buildAutomationRunReportPrompt } from './automation-run-report-prompt'

describe.skipIf(process.platform === 'win32')('automation reporting in login shells', () => {
  it.each(['desktop', 'ssh', 'wsl', 'structured'] as const)(
    'uses the %s execution host CLI after startup files reset PATH',
    async (host) => {
      const root = mkdtempSync(join(tmpdir(), 'orca-report-shell-'))
      try {
        const managedBin = join(root, 'managed cli 系统')
        const globalBin = join(root, 'global')
        mkdirSync(managedBin)
        mkdirSync(globalBin)
        const launcher = join(managedBin, host === 'wsl' ? 'orca-ide' : 'orca')
        writeFileSync(launcher, '#!/bin/sh\nprintf "%s\\n" "$@"\n')
        chmodSync(launcher, 0o755)
        writeFileSync(join(globalBin, 'orca'), '#!/bin/sh\necho wrong-global-cli >&2\nexit 1\n')
        chmodSync(join(globalBin, 'orca'), 0o755)
        const prompt = buildAutomationRunReportPrompt('Report the test failure', {
          id: 'run-1',
          reportToken: 'token-1'
        })
        const command = prompt.split('\n').find((line) => line.includes('--status failed'))
        expect(command).toBeDefined()
        const env = {
          ...process.env,
          ORCA_CLI_COMMAND: host === 'structured' ? launcher : host === 'wsl' ? 'orca-ide' : '',
          ORCA_CLI_BIN_DIR: host === 'desktop' || host === 'ssh' ? managedBin : '',
          ORCA_WSL_CLI_DIR: host === 'wsl' ? managedBin : ''
        }
        const result = await runProcess({
          program: '/bin/sh',
          args: ['-c', `export PATH="${globalBin}:/usr/bin:/bin"\n${command}`],
          env
        })
        expect(result.stderr).not.toContain('wrong-global-cli')
        expect(result.code).toBe(0)
        expect(result.stdout.trim().split('\n')).toEqual([
          'automations',
          'report',
          '--run-id',
          'run-1',
          '--run-token',
          'token-1',
          '--status',
          'failed',
          '--message',
          'Describe the failure'
        ])
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  )
})
