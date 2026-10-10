import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { nameDarwinTerminals } from './darwin-terminal-names'
import { PS_ARGS } from './process-table-snapshot'

function ttyByPid(stdout: string): Map<string, string> {
  return new Map(
    stdout
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        const [pid, , , , , tty] = line.trim().split(/\s+/)
        return [pid, tty]
      })
  )
}

describe.runIf(process.platform === 'darwin')('nameDarwinTerminals against real ps', () => {
  it('matches ps terminal names for every process present in both captures', async () => {
    // Retry once: a terminal can close between the two ps runs.
    let mismatches: string[] = []
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const raw = execFileSync('ps', ['-axo', PS_ARGS[1].replace('tty=', 'tdev=')], {
        encoding: 'utf8'
      })
      const canonical = ttyByPid(execFileSync('ps', [...PS_ARGS], { encoding: 'utf8' }))
      const named = ttyByPid(await nameDarwinTerminals(raw))
      mismatches = [...named]
        .filter(([pid, tty]) => canonical.has(pid) && canonical.get(pid) !== tty)
        .map(([pid, tty]) => `${pid}: ${tty} != ${canonical.get(pid)}`)
      if (mismatches.length === 0) {
        break
      }
    }
    expect(mismatches).toEqual([])
  })
})
